#!/usr/bin/env bash
#
# Build MOPAC 7.00 (1993, public domain) as WebAssembly, from nothing but this
# repository, a C compiler and emscripten. There is no Fortran compiler
# anywhere in this pipeline.
#
#   scripts/build-wasm.sh [--opt O3|O2|Os|Oz] [--work DIR] [--out DIR]
#                         [--native] [--jobs N] [--offline]
#
# Pipeline:
#   1  fetch f2c        barak/f2c at a pinned commit          -> native f2c
#   2  fetch libf2c     netlib zip at a pinned sha256         -> wasm libf2c.a
#   3  fetch MOPAC 7.00 openmopac/MOPAC-archive, pinned, sparse
#   4  apply patches/fortran/*.patch
#   5  f2c -A -E -ec    -> one .c per .f, plus one <name>_com.c per COMMON
#   6  apply patches/c/*.patch to the generated C
#   6b make every COMMON block as large as its largest declaration
#      (scripts/check-commons.mjs) -- f2c does not, and in MOPAC 7 that is a
#      live buffer overflow
#   7  emcc every .c plus patches/shim.c
#   8  drop the COMMON objects that BLOCK DATA also defines (computed with
#      emnm, never hard-coded), then link
#   9  write <out>/mopac7.mjs, <out>/mopac7.wasm, <out>/BUILD.json
#  11  embed both in JavaScript -> <out>/data.js, <out>/glue.js (what npm ships)
#
# Every step fails loudly. Two failure modes here are silent by default and are
# therefore checked explicitly, and fatal:
#
#   * f2c EXITS 0 even when it prints "Error on line N of x.f" and emits a
#     truncated translation unit.
#   * wasm-ld only WARNS on "function signature mismatch" and links a trapping
#     stub, so the module aborts at run time with a bare
#     "RuntimeError: unreachable" and no message at all.
#
set -o errexit
set -o nounset
set -o pipefail

# =========================================================================== #
# Pins. Change any of these and you are building something else.
# =========================================================================== #

# openmopac/MOPAC-archive. 1993_MOPAC7/ is QCPE #688, MOPAC 7.00, by
# J. J. P. Stewart. The program is public domain -- mopac.f lines 3-12 carry
# "This computer program is a work of the United States Government and as such
# is not subject to protection by copyright (17 U.S.C. # 105.)" -- and the
# archive collection around it is BSD-3-Clause (Virginia Tech, 2021).
readonly MOPAC_REPO='https://github.com/openmopac/MOPAC-archive.git'
readonly MOPAC_COMMIT='ed31531485fde27106e8e700fc8461b514923929'
readonly MOPAC_SUBDIR='1993_MOPAC7'
readonly MOPAC_FILE_COUNT=172
# sha256 of `find . -type f | sort | xargs shasum -a 256 | shasum -a 256` over
# the subdirectory: catches a changed file even if the commit resolves.
readonly MOPAC_TREE_SHA256='edaa50a6f0f581ea67241056f66c09e0919a6a922bacb4f57462d8ebdf55ee4c'

# barak/f2c -- the netlib f2c translator plus its Debian packaging history.
# This commit builds as f2c "version 20240504".
readonly F2C_REPO='https://github.com/barak/f2c.git'
readonly F2C_COMMIT='92d296bc389387ab83ec9b73dadebee7fbf5d10c'
readonly F2C_VERSION='20240504'

# netlib's f2c runtime. netlib publishes no version and no tag, so the checksum
# IS the version. If this check ever fails, diff the new zip before bumping it:
# patches/shim.c depends on s_copy / s_cat / getenv_ returning void.
readonly LIBF2C_URL='https://netlib.org/f2c/libf2c.zip'
readonly LIBF2C_SHA256='cc84253b47b5c036aa1d529332a6c218a39ff71c76974296262b03776f822695'

# libf2c sources outside the stock Unix build (they are not in makefile.u's
# OFILES): the arithmetic prober, INTEGER*8 support, signed zeros.
readonly LIBF2C_SKIP=' arithchk.c ftell64_.c pow_qq.c qbitbits.c qbitshft.c signbit.c '

# f2c flags. Each one is load-bearing:
#   -A   ANSI C (prototypes). Without it the output is K&R and clang 16+ warns
#        on every call.
#   -E   declare uninitialised COMMON blocks extern instead of tentatively, and
#   -ec  emit each one into its own <name>_com.c. MANDATORY on wasm: a tentative
#        definition is a common symbol, and wasm-ld says
#        "common symbols are not yet implemented for Wasm".
#   -I.  find the INCLUDE 'SIZES' file.
#   -w   suppress the warnings about MOPAC's own non-standard Fortran; the
#        errors we do care about are still printed and still checked for.
#   NOT -a: with automatic (stack) locals MOPAC 7 segfaults, natively and in
#        wasm. It relies on F77 static/SAVE semantics throughout.
readonly F2C_FLAGS='-A -E -ec -I. -w'

# C flags for the translated MOPAC. -fno-strict-aliasing because f2c output
# aliases freely (EQUIVALENCE, COMMON re-typing); the three -Wno- flags are for
# 1990s Fortran habits that clang 16+ reports by default.
readonly MOPAC_CFLAGS='-std=gnu17 -fno-strict-aliasing -Wno-incompatible-pointer-types -Wno-implicit-function-declaration -Wno-deprecated-non-prototype'

# Link flags.
#   MODULARIZE + EXPORT_ES6  -> an ES module exporting a factory
#   ALLOW_MEMORY_GROWTH      -> MOPAC sizes its static arrays from SIZES, but
#                               MEMFS grows with the job's files
#   STACK_SIZE=32MB          -> f2c keeps large arrays in automatic storage in
#                               a few routines; the 64 KB default overflows
#   INVOKE_RUN=0             -> the caller decides when main() runs, after it
#                               has written the input file and set ENV
#   FORCE_FILESYSTEM         -> MOPAC is a file-in/file-out program
#   EXPORTED_RUNTIME_METHODS -> callMain, FS and ENV are the whole API surface
#   EXPORTED_FUNCTIONS       -> _main, plus _fflush. MANDATORY: libf2c writes
#                               unit 6 through a buffered FILE*, and with
#                               EXIT_RUNTIME off nothing flushes it when main
#                               returns, so the LISTING IS SILENTLY TRUNCATED
#                               at the last buffer boundary -- measured on water
#                               PM3 as 11,619 of 11,915 bytes, losing the whole
#                               final geometry. The caller must run _fflush(0)
#                               after callMain.
#   ENVIRONMENT=web,worker   -> no node branch, so the glue carries no
#                               `await import("node:module")` and no
#                               `require("node:fs")` for a bundler to trip over.
#                               It still runs under node, because the only
#                               reason the glue would touch a filesystem is to
#                               locate its .wasm, and the package hands it an
#                               already compiled WebAssembly.Module through
#                               instantiateWasm, so it never looks.
readonly LINK_FLAGS='-sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=32MB -sINVOKE_RUN=0 -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=callMain,FS,ENV -sEXPORTED_FUNCTIONS=_main,_fflush'

# =========================================================================== #
# Options
# =========================================================================== #
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# -Os is the default because it is measurably the better trade for a package
# that is downloaded: it produces the same numbers bit for bit (all 306
# verification levels) at 789,543 bytes raw / 257,079 brotli against -O3's
# 990,691 / 291,189 -- 20% smaller raw, 12% smaller brotli -- for a few per cent
# of run time, which is inside the run-to-run spread on these decks. -Oz saves
# another 4% of brotli and is consistently the slowest. Pass --opt O3 for the
# fast build; every level is verified by scripts/verify.mjs. See BUILD.md.
OPT='Os'
WORK="${REPO_ROOT}/build"
OUT="${REPO_ROOT}/wasm"
BUILD_NATIVE='no'
OFFLINE='no'
if command -v sysctl >/dev/null 2>&1; then JOBS="$(sysctl -n hw.ncpu)"
elif command -v nproc >/dev/null 2>&1; then JOBS="$(nproc)"
else JOBS=4; fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --opt) OPT="${2:?--opt needs a value}"; shift 2 ;;
    --work) WORK="${2:?--work needs a directory}"; shift 2 ;;
    --out) OUT="${2:?--out needs a directory}"; shift 2 ;;
    --jobs) JOBS="${2:?--jobs needs a number}"; shift 2 ;;
    --native) BUILD_NATIVE='yes'; shift ;;
    --offline) OFFLINE='yes'; shift ;;
    -h|--help) sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^#//'; exit 0 ;;
    *) printf 'build-wasm.sh: unknown option %s\n' "$1" >&2; exit 2 ;;
  esac
done
case "$OPT" in O3|O2|Os|Oz) ;; *) printf 'build-wasm.sh: --opt must be O3, O2, Os or Oz\n' >&2; exit 2 ;; esac

# The build cds around, so resolve every path to an absolute one up front.
mkdir -p "$WORK" "$OUT"
WORK="$(cd -- "$WORK" && pwd)"
OUT="$(cd -- "$OUT" && pwd)"

PATCHES="${REPO_ROOT}/patches"
DL_DIR="${WORK}/downloads"
LOG_DIR="${WORK}/logs"
F2C_DIR="${WORK}/f2c"
LIBF2C_DIR="${WORK}/libf2c-${OPT}"
SRC_DIR="${WORK}/mopac7-fortran"
C_DIR="${WORK}/mopac7-c-${OPT}"
NATIVE_DIR="${WORK}/native"

step() { printf '\n=== %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\nbuild-wasm.sh: FATAL: %s\n' "$*" >&2; exit 1; }

# =========================================================================== #
# Helpers
# =========================================================================== #

# Fetch exactly one commit, with no history and no unrelated trees.
# $1 repo url, $2 commit sha, $3 destination, $4.. sparse-checkout paths
fetch_commit() {
  local url="$1" commit="$2" dest="$3"; shift 3
  if [[ "$OFFLINE" == 'yes' ]]; then
    [[ -d "$dest" ]] || die "--offline but $dest is not there yet"
    info "offline: reusing $dest"
    return
  fi
  rm -rf "$dest"
  mkdir -p "$dest"
  (
    cd "$dest"
    git init -q .
    git remote add origin "$url"
    if [[ $# -gt 0 ]]; then
      git config core.sparseCheckout true
      git sparse-checkout init --cone
      git sparse-checkout set "$@"
    fi
    GIT_TERMINAL_PROMPT=0 git fetch -q --depth 1 --filter=blob:none origin "$commit" \
      || die "cannot fetch $commit from $url"
    git checkout -q FETCH_HEAD
    local got
    got="$(git rev-parse HEAD)"
    [[ "$got" == "$commit" ]] || die "$url checked out $got, expected $commit"
  )
}

# $1 url, $2 expected sha256, $3 destination file
fetch_checked() {
  local url="$1" want="$2" dest="$3" got
  if [[ ! -f "$dest" ]]; then
    [[ "$OFFLINE" == 'yes' ]] && die "--offline but $dest is not cached"
    curl -fsSL --retry 3 -o "${dest}.part" "$url" || die "download failed: $url"
    mv "${dest}.part" "$dest"
  fi
  got="$(shasum -a 256 "$dest" | cut -d' ' -f1)"
  [[ "$got" == "$want" ]] || die "$dest sha256 is $got, expected $want"
  info "sha256 ok  $(basename "$dest")"
}

# =========================================================================== #
step 'preflight'
# =========================================================================== #
for tool in emcc emar emranlib emnm node git curl shasum unzip patch make cc; do
  command -v "$tool" >/dev/null || die "$tool is not on PATH"
done
info "emcc  $(emcc --version | head -1)"
info "node  $(node --version)"
info "cc    $(cc --version | head -1)"
info "opt   -${OPT}   jobs ${JOBS}"
mkdir -p "$DL_DIR" "$LOG_DIR" "$OUT"
# Keep emscripten's sysroot cache inside the build tree: the default lives in
# the install prefix, which is read-only in some installations.
export EM_CACHE="${EM_CACHE:-${WORK}/emcache}"
mkdir -p "$EM_CACHE"

# =========================================================================== #
step "1  f2c ${F2C_VERSION} (${F2C_COMMIT:0:12})"
# =========================================================================== #
F2C="${F2C_DIR}/src/f2c"
if [[ ! -x "$F2C" ]]; then
  fetch_commit "$F2C_REPO" "$F2C_COMMIT" "$F2C_DIR"
  ( cd "${F2C_DIR}/src" && cp makefile.u makefile && make -s f2c ) \
    > "${LOG_DIR}/f2c-build.log" 2>&1 || { tail -30 "${LOG_DIR}/f2c-build.log"; die 'f2c did not build'; }
fi
[[ -x "$F2C" ]] || die 'f2c binary is missing after build'
f2c_reported="$("$F2C" -v </dev/null 2>&1 | head -1 | grep -o '[0-9]\{8\}' || true)"
[[ "$f2c_reported" == "$F2C_VERSION" ]] \
  || die "f2c reports version '${f2c_reported}', expected ${F2C_VERSION}"
info "f2c version ${f2c_reported}"

# =========================================================================== #
step '2  libf2c for wasm'
# =========================================================================== #
fetch_checked "$LIBF2C_URL" "$LIBF2C_SHA256" "${DL_DIR}/libf2c.zip"
if [[ ! -f "${LIBF2C_DIR}/libf2c.a" ]]; then
  rm -rf "$LIBF2C_DIR"; mkdir -p "$LIBF2C_DIR"
  unzip -q -o "${DL_DIR}/libf2c.zip" -d "$LIBF2C_DIR"
  cd "$LIBF2C_DIR"
  # The zip ships these three as .h0 templates for the installer to choose.
  cp f2c.h0 f2c.h
  cp signal1.h0 signal1.h
  cp sysdep1.h0 sysdep1.h
  # arith.h must describe the TARGET's floating point, so arithchk has to run
  # as wasm under node -- not natively. On a 64-bit macOS/arm64 host the native
  # answer happens to agree, but that is luck, not a rule.
  emcc -DNO_FPINIT -O1 arithchk.c -o arithchk.cjs -sENVIRONMENT=node -sEXIT_RUNTIME=1 \
    > "${LOG_DIR}/arithchk.log" 2>&1 || { tail -20 "${LOG_DIR}/arithchk.log"; die 'arithchk did not build'; }
  node arithchk.cjs > arith.h || die 'arithchk did not run under node'
  grep -q 'Arith_Kind_ASL' arith.h || { cat arith.h; die 'arith.h looks wrong'; }
  info "arith.h: $(tr '\n' ' ' < arith.h)"

  # s_copy / s_cat / getenv_ are compiled under private names so patches/shim.c
  # can wrap them with the int-returning signature f2c generates calls for.
  # See patches/shim.c; renaming beats patching libf2c because it survives a
  # netlib refresh.
  compiled=0
  for source in *.c; do
    [[ "$LIBF2C_SKIP" == *" ${source} "* ]] && continue
    rename=''
    case "$source" in
      s_copy.c)  rename='-Ds_copy=s_copy_impl' ;;
      s_cat.c)   rename='-Ds_cat=s_cat_impl' ;;
      getenv_.c) rename='-Dgetenv_=getenv_impl' ;;
    esac
    emcc -c -DSkip_f2c_Undefs "-${OPT}" ${rename} "$source" -o "${source%.c}.o" \
      >> "${LOG_DIR}/libf2c-build.log" 2>&1 \
      || { tail -20 "${LOG_DIR}/libf2c-build.log"; die "libf2c: $source did not compile"; }
    compiled=$((compiled + 1))
  done
  info "compiled ${compiled} libf2c sources"
  emar rcs libf2c.a ./*.o
  emranlib libf2c.a
  cd "$REPO_ROOT"
fi
[[ -f "${LIBF2C_DIR}/libf2c.a" ]] || die 'libf2c.a is missing'
info "libf2c.a $(wc -c < "${LIBF2C_DIR}/libf2c.a") bytes"

# =========================================================================== #
step "3  MOPAC 7.00 source (${MOPAC_COMMIT:0:12})"
# =========================================================================== #
ARCHIVE_DIR="${WORK}/mopac-archive"
if [[ ! -d "${ARCHIVE_DIR}/${MOPAC_SUBDIR}" ]]; then
  fetch_commit "$MOPAC_REPO" "$MOPAC_COMMIT" "$ARCHIVE_DIR" "$MOPAC_SUBDIR"
fi
[[ -d "${ARCHIVE_DIR}/${MOPAC_SUBDIR}" ]] || die "${MOPAC_SUBDIR} is not in the checkout"
tree_files="$(find "${ARCHIVE_DIR}/${MOPAC_SUBDIR}" -type f | wc -l | tr -d ' ')"
[[ "$tree_files" == "$MOPAC_FILE_COUNT" ]] \
  || die "${MOPAC_SUBDIR} has ${tree_files} files, expected ${MOPAC_FILE_COUNT}"
tree_sha="$( cd "${ARCHIVE_DIR}/${MOPAC_SUBDIR}" \
  && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1 )"
[[ "$tree_sha" == "$MOPAC_TREE_SHA256" ]] \
  || die "${MOPAC_SUBDIR} tree sha256 is ${tree_sha}, expected ${MOPAC_TREE_SHA256}"
info "tree sha256 ok, ${tree_files} files"
grep -q '17 U.S.C' "${ARCHIVE_DIR}/${MOPAC_SUBDIR}/mopac.f" \
  || die 'the public-domain notice is not in mopac.f -- refusing to build'
info 'public-domain notice present in mopac.f'

# =========================================================================== #
step '4  apply the Fortran patches'
# =========================================================================== #
rm -rf "$SRC_DIR"; mkdir -p "$SRC_DIR"
cp "${ARCHIVE_DIR}/${MOPAC_SUBDIR}"/* "$SRC_DIR/"
fortran_count="$(ls "$SRC_DIR"/*.f | wc -l | tr -d ' ')"
[[ "$fortran_count" == '156' ]] || die "expected 156 Fortran files, found ${fortran_count}"
applied=0
for patchfile in "${PATCHES}/fortran"/*.patch; do
  ( cd "$SRC_DIR" && patch -p1 --forward --no-backup-if-mismatch --silent < "$patchfile" ) \
    || die "patch did not apply: $(basename "$patchfile")"
  info "applied $(basename "$patchfile")"
  applied=$((applied + 1))
done
[[ "$applied" -ge 1 ]] || die 'no Fortran patch was applied -- patches/fortran is empty?'

# =========================================================================== #
step '5  translate with f2c'
# =========================================================================== #
rm -rf "$C_DIR"; mkdir -p "$C_DIR"
cp "$SRC_DIR"/*.f "$SRC_DIR/SIZES" "$C_DIR/"
cp "${LIBF2C_DIR}/f2c.h" "$C_DIR/f2c.h"
( cd "$C_DIR" && "$F2C" ${F2C_FLAGS} ./*.f ) > "${LOG_DIR}/f2c-translate.log" 2>&1 || true
# f2c EXITS 0 on a translation error and still writes a truncated .c.
if grep -q 'Error on line' "${LOG_DIR}/f2c-translate.log"; then
  grep -n 'Error on line' "${LOG_DIR}/f2c-translate.log" >&2
  die 'f2c reported translation errors (it exits 0 anyway -- see the log)'
fi
c_count="$(ls "$C_DIR"/*.c | wc -l | tr -d ' ')"
com_count="$(ls "$C_DIR"/*_com.c 2>/dev/null | wc -l | tr -d ' ')"
info "${c_count} C files (${com_count} of them COMMON blocks)"
[[ "$((c_count - com_count))" == '156' ]] \
  || die "f2c produced $((c_count - com_count)) translation units for 156 Fortran files"

# =========================================================================== #
step '6  apply the generated-C patches'
# =========================================================================== #
for patchfile in "${PATCHES}/c"/*.patch; do
  ( cd "$C_DIR" && patch -p1 --forward --no-backup-if-mismatch --silent < "$patchfile" ) \
    || die "patch did not apply to the f2c output: $(basename "$patchfile")

f2c is pinned to ${F2C_VERSION}, so this should not drift. If you moved the pin,
re-cut the patch by hand against the new output -- do not add --fuzz."
  info "applied $(basename "$patchfile")"
done

# =========================================================================== #
step '6b  equalise the COMMON block sizes'
# =========================================================================== #
# f2c sizes each COMMON block from one file's view, not from the largest one,
# which is what Fortran 77 requires. MOPAC 7.00 has blocks where that
# difference is a live buffer overflow, and it is the reason a native build and
# a wasm build of the identical C can disagree. scripts/check-commons.mjs has
# the full reasoning; it pads what it safely can and fails on anything else.
node "${REPO_ROOT}/scripts/check-commons.mjs" --dir "$C_DIR" \
  --json "${LOG_DIR}/padded-commons.json" || die 'a COMMON block cannot be made consistent'

# =========================================================================== #
step "7  compile (-${OPT})"
# =========================================================================== #
cp "${PATCHES}/shim.c" "$C_DIR/shim.c"
cd "$C_DIR"
# A one-source-at-a-time wrapper, so xargs passes a bare filename rather than
# a whole command line (BSD xargs gives up with "command line cannot be
# assembled, too long" as soon as the -I template gets long).
cat > cc-one.sh <<'WRAPPER'
#!/bin/sh
set -e
exec emcc -c "-${OPT}" ${MOPAC_CFLAGS} -I. "$1" -o "${1%.c}.o"
WRAPPER
chmod +x cc-one.sh
export OPT MOPAC_CFLAGS
: > "${LOG_DIR}/mopac-cc.log"
printf '%s\n' *.c | xargs -P "$JOBS" -n 1 ./cc-one.sh 2>> "${LOG_DIR}/mopac-cc.log" \
  || { grep -m20 'error:' "${LOG_DIR}/mopac-cc.log" >&2 || true; die 'a MOPAC translation unit did not compile'; }
object_count="$(ls ./*.o | wc -l | tr -d ' ')"
[[ "$object_count" == "$((c_count + 1))" ]] \
  || die "compiled ${object_count} objects for $((c_count + 1)) sources"
info "${object_count} objects"

# =========================================================================== #
step '8  drop the duplicated COMMON objects and link'
# =========================================================================== #
# f2c -ec emits one object per uninitialised COMMON block, but MOPAC's BLOCK
# DATA units (block.f, consts.f) also define some of those blocks with real
# initialisers. Linking both is a duplicate symbol. Which ones overlap is
# COMPUTED from the object files, so a change upstream cannot silently slip
# past a hard-coded list.
for object in ./*.o; do
  case "$object" in *_com.o) continue ;; esac
  emnm --defined-only --extern-only "$object" | awk '{ print $3 }'
done | LC_ALL=C sort -u > defined-elsewhere.txt

: > dropped-com.txt
: > link-objects.rsp
for object in ./*.o; do
  case "$object" in
    *_com.o)
      symbol="$(emnm --defined-only --extern-only "$object" | awk '{ print $3 }')"
      if grep -qx -- "$symbol" defined-elsewhere.txt; then
        printf '%s %s\n' "$object" "$symbol" >> dropped-com.txt
        continue
      fi
      ;;
  esac
  printf '%s\n' "$object" >> link-objects.rsp
done
dropped="$(wc -l < dropped-com.txt | tr -d ' ')"
linked="$(wc -l < link-objects.rsp | tr -d ' ')"
info "dropping ${dropped} duplicated COMMON objects, linking ${linked}"
[[ "$dropped" -gt 0 ]] || die 'no duplicated COMMON object was found -- the detection is broken'

emcc "-${OPT}" @link-objects.rsp "${LIBF2C_DIR}/libf2c.a" -o "${OUT}/mopac7.mjs" \
  ${LINK_FLAGS} 2>&1 | tee "${LOG_DIR}/link.log"
# wasm-ld only warns here and then links a trapping stub, which aborts at run
# time with an unexplained "RuntimeError: unreachable". Never tolerate one.
if grep -q 'signature mismatch' "${LOG_DIR}/link.log"; then
  grep -A2 'signature mismatch' "${LOG_DIR}/link.log" >&2
  die 'wasm-ld reported a function signature mismatch: every one is a latent
runtime abort with no message. Fix the call site (a patch under patches/) or
add a wrapper to patches/shim.c. Do not ship this.'
fi
[[ -f "${OUT}/mopac7.wasm" ]] || die 'no mopac7.wasm was produced'
info "mopac7.wasm $(wc -c < "${OUT}/mopac7.wasm") bytes"
info "mopac7.mjs  $(wc -c < "${OUT}/mopac7.mjs") bytes"

# =========================================================================== #
step '9  optional native build (for A/B against the wasm)'
# =========================================================================== #
if [[ "$BUILD_NATIVE" == 'yes' ]]; then
  "${REPO_ROOT}/scripts/build-native.sh" --work "$WORK" --c-dir "$C_DIR" \
    --libf2c-zip "${DL_DIR}/libf2c.zip" --out "$NATIVE_DIR" \
    || die 'the native build failed'
  info "native binary ${NATIVE_DIR}/mopac7"
else
  info 'skipped (pass --native to build it)'
fi

# =========================================================================== #
step '10  provenance'
# =========================================================================== #
node "${REPO_ROOT}/scripts/write-build-json.mjs" \
  --out "${OUT}/BUILD.json" \
  --wasm "${OUT}/mopac7.wasm" \
  --glue "${OUT}/mopac7.mjs" \
  --opt "$OPT" \
  --emcc "$(emcc --version | head -1)" \
  --f2c "$F2C_VERSION" \
  --mopac-commit "$MOPAC_COMMIT" \
  --mopac-tree-sha "$MOPAC_TREE_SHA256" \
  --f2c-commit "$F2C_COMMIT" \
  --libf2c-sha "$LIBF2C_SHA256" \
  --dropped "${C_DIR}/dropped-com.txt" \
  --patches "$PATCHES"
cat "${OUT}/BUILD.json"

printf '\n=== done: %s\n' "$OUT"

# =========================================================================== #
step '11  embed the binary in JavaScript'
# =========================================================================== #
node "${REPO_ROOT}/scripts/embed-wasm.mjs" --wasm-dir "$OUT" --sizes "${SRC_DIR}/SIZES"
