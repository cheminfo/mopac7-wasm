#!/usr/bin/env bash
#
# Build the SAME f2c output natively, so the wasm can be A/B'd against a
# host binary of identical provenance. This is a verification aid, not a
# deliverable: nothing in the published package uses it.
#
#   scripts/build-native.sh --c-dir DIR --libf2c-zip FILE [--work DIR] [--out DIR]
#
# --c-dir is the directory build-wasm.sh left its f2c output in
# (build/mopac7-c-<opt>). Only the .c files are read; the wasm .o files there
# are ignored.
#
set -o errexit
set -o nounset
set -o pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${REPO_ROOT}/build"
C_DIR=''
LIBF2C_ZIP=''
OUT=''
if command -v sysctl >/dev/null 2>&1; then JOBS="$(sysctl -n hw.ncpu)"
elif command -v nproc >/dev/null 2>&1; then JOBS="$(nproc)"
else JOBS=4; fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --work) WORK="$2"; shift 2 ;;
    --c-dir) C_DIR="$2"; shift 2 ;;
    --libf2c-zip) LIBF2C_ZIP="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --jobs) JOBS="$2"; shift 2 ;;
    *) printf 'build-native.sh: unknown option %s\n' "$1" >&2; exit 2 ;;
  esac
done
[[ -n "$C_DIR" && -d "$C_DIR" ]] || { printf 'build-native.sh: --c-dir must be an existing directory\n' >&2; exit 2; }
[[ -f "$LIBF2C_ZIP" ]] || { printf 'build-native.sh: --libf2c-zip must be a file\n' >&2; exit 2; }
# Everything below cds around, so resolve every path to an absolute one first.
WORK="$(cd -- "$WORK" && pwd)"
C_DIR="$(cd -- "$C_DIR" && pwd)"
LIBF2C_ZIP="$(cd -- "$(dirname -- "$LIBF2C_ZIP")" && pwd)/$(basename -- "$LIBF2C_ZIP")"
OUT="${OUT:-${WORK}/native}"
mkdir -p "$OUT"
OUT="$(cd -- "$OUT" && pwd)"

step() { printf '\n--- %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\nbuild-native.sh: FATAL: %s\n' "$*" >&2; exit 1; }

NATIVE_LIBF2C="${WORK}/libf2c-native"
LOG_DIR="${WORK}/logs"
mkdir -p "$OUT" "$LOG_DIR"

step 'native libf2c'
if [[ ! -f "${NATIVE_LIBF2C}/libf2c.a" ]]; then
  rm -rf "$NATIVE_LIBF2C"; mkdir -p "$NATIVE_LIBF2C"
  unzip -q -o "$LIBF2C_ZIP" -d "$NATIVE_LIBF2C"
  cd "$NATIVE_LIBF2C"
  cp f2c.h0 f2c.h; cp signal1.h0 signal1.h; cp sysdep1.h0 sysdep1.h
  # netlib's f2c.h says `typedef long int integer`, which is right on wasm32
  # (long is 32 bits) and WRONG on any LP64 host, where it silently gives
  # Fortran INTEGER*8. The arithmetic still works -- which is why this hides --
  # but every Hollerith constant and every EQUIVALENCE that overlays CHARACTER
  # on INTEGER is then laid out differently from the wasm build. In MOPAC 7
  # that shows up as symtrz.f's packed point-group table never matching, so a
  # naive native build prints `MOLECULAR POINT GROUP : ????` for every
  # molecule. Narrow the integer types so the A/B compares like with like.
  sed -i.bak -E 's/^typedef long int (integer|logical|flag|ftnlen|ftnint);/typedef int \1;/; s/^typedef unsigned long int uinteger;/typedef unsigned int uinteger;/' f2c.h
  grep -q '^typedef int integer;' f2c.h || die 'could not narrow integer in the native f2c.h'
  cc -DNO_FPINIT -O1 arithchk.c -o arithchk -lm >/dev/null 2>&1 || die 'native arithchk did not build'
  ./arithchk > arith.h
  # Same three renames as the wasm build, so both targets go through
  # patches/shim.c and there is exactly one code path to reason about.
  for source in *.c; do
    case " arithchk.c ftell64_.c pow_qq.c qbitbits.c qbitshft.c signbit.c " in
      *" ${source} "*) continue ;;
    esac
    rename=''
    case "$source" in
      s_copy.c)  rename='-Ds_copy=s_copy_impl' ;;
      s_cat.c)   rename='-Ds_cat=s_cat_impl' ;;
      getenv_.c) rename='-Dgetenv_=getenv_impl' ;;
    esac
    cc -c -DSkip_f2c_Undefs -O2 -std=gnu17 -Wno-implicit-function-declaration \
      -Wno-deprecated-non-prototype ${rename} "$source" -o "${source%.c}.o" \
      >> "${LOG_DIR}/libf2c-native.log" 2>&1 || die "native libf2c: $source did not compile"
  done
  ar rcs libf2c.a ./*.o
  ranlib libf2c.a 2>/dev/null || true
  cd "$REPO_ROOT"
fi
info "libf2c.a $(wc -c < "${NATIVE_LIBF2C}/libf2c.a") bytes"

step 'native MOPAC objects (same f2c C as the wasm)'
NATIVE_OBJ="${OUT}/obj"
NATIVE_SRC="${OUT}/src"
rm -rf "$NATIVE_OBJ" "$NATIVE_SRC"; mkdir -p "$NATIVE_OBJ" "$NATIVE_SRC"
# The sources are copied rather than compiled in place because `#include
# "f2c.h"` resolves against the INCLUDING FILE'S directory before any -I, so a
# narrowed f2c.h next to them is the only way to give the native build 32-bit
# Fortran integers without disturbing the wasm build's own copy.
cp "$C_DIR"/*.c "$C_DIR/SIZES" "$NATIVE_SRC/"
cp "${NATIVE_LIBF2C}/f2c.h" "$NATIVE_SRC/f2c.h"
cp "${C_DIR}/dropped-com.txt" "$NATIVE_SRC/"
C_DIR="$NATIVE_SRC"
cd "$C_DIR"
cat > cc-one-native.sh <<'WRAPPER'
#!/bin/sh
set -e
exec cc -c -O2 -std=gnu17 -fno-strict-aliasing -Wno-incompatible-pointer-types \
  -Wno-implicit-function-declaration -Wno-deprecated-non-prototype \
  -I"$NATIVE_LIBF2C" -I. "$1" -o "$NATIVE_OBJ/${1%.c}.o"
WRAPPER
chmod +x cc-one-native.sh
export NATIVE_LIBF2C NATIVE_OBJ
: > "${LOG_DIR}/mopac-native-cc.log"
printf '%s\n' *.c | xargs -P "$JOBS" -n 1 ./cc-one-native.sh 2>> "${LOG_DIR}/mopac-native-cc.log" \
  || { grep -m10 'error:' "${LOG_DIR}/mopac-native-cc.log" >&2 || true; die 'a MOPAC translation unit did not compile natively'; }

step 'link'
# The same computed drop list the wasm link uses. The reason is different here
# (a native linker reports duplicate symbols rather than common ones) but the
# set is identical, so reuse it rather than recompute.
[[ -f "${C_DIR}/dropped-com.txt" ]] || die "run build-wasm.sh first: ${C_DIR}/dropped-com.txt is missing"
: > "${OUT}/link-objects.rsp"
for object in "${NATIVE_OBJ}"/*.o; do
  base="$(basename "$object")"
  grep -q "^\./${base} " "${C_DIR}/dropped-com.txt" && continue
  printf '%s\n' "$object" >> "${OUT}/link-objects.rsp"
done
info "linking $(wc -l < "${OUT}/link-objects.rsp" | tr -d ' ') objects"
# shellcheck disable=SC2046
cc -O2 $(cat "${OUT}/link-objects.rsp") "${NATIVE_LIBF2C}/libf2c.a" -lm -o "${OUT}/mopac7" \
  > "${LOG_DIR}/native-link.log" 2>&1 || { tail -30 "${LOG_DIR}/native-link.log"; die 'the native link failed'; }
info "mopac7 $(wc -c < "${OUT}/mopac7") bytes"
