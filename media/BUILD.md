# Building MOPAC 7 for WebAssembly

This directory builds **MOPAC 7.00** — the 1993 public-domain semi-empirical
NDDO program by J. J. P. Stewart, QCPE #688, offering MNDO, AM1 and PM3 — into a
single WebAssembly module that runs in Node and in a browser.

There is **no Fortran compiler** anywhere in the pipeline. The 156 Fortran-77
files are translated to C with [f2c](https://netlib.org/f2c/) and compiled with
emscripten.

```sh
scripts/build-wasm.sh              # -> wasm/{mopac7.mjs,mopac7.wasm,data.js,glue.js,BUILD.json}
scripts/build-wasm.sh --native     # also builds the same C natively, for the A/B
node scripts/verify.mjs            # 42 decks against the reference, and against native
node scripts/bench.mjs             # cold init and per-deck timings
```

A clean run — nothing cached, everything fetched — takes **1 min 45 s to
2 min 45 s** on an 8-core arm64 Mac depending on load, including the native
build; about 40 s of that is the wasm alone once f2c and libf2c are built. The
wasm is **byte-reproducible**: two clean builds at the same optimisation level
produce the same `sha256`.

## What it produces

`wasm/mopac7.mjs` is an ES module exporting an emscripten factory and
`wasm/mopac7.wasm` is the module, but neither is committed and neither is
published: step 11 runs `scripts/embed-wasm.mjs`, which gzips the binary,
base64-encodes it and writes the two modules the npm package actually ships —
`wasm/data.js` (the payload) and `wasm/glue.js` (the factory). That is why a
consumer has no `.wasm` file to serve and needs no bundler plugin.
`wasm/BUILD.json` records the pins, the patches, the sizes, the digests and the
`SIZES` bounds of that exact build; `wasm/glue.d.ts` is hand-written, because
emscripten emits no declarations.

At the default `-Os`:

| file           |         raw |     gzip -9 |  brotli -11 |
| -------------- | ----------: | ----------: | ----------: |
| `mopac7.wasm`  |     792,215 |     306,481 |     257,703 |
| `mopac7.mjs`   |      65,122 |      18,149 |      16,227 |
| **total**      | **857,337** | **324,895** | **274,128** |
| `wasm/data.js` |     408,816 |           — |           — |
| `wasm/glue.js` |      65,325 |           — |           — |

`data.js` is the gzipped binary written out as base64, so it is larger than the
gzip figure above and smaller than the raw one; a CDN gzips it again on the wire.

## Two link flags that are not optional

`-sENVIRONMENT=web,worker` keeps the node branch out of the glue, so it carries
no `await import("node:module")` and no `require("node:fs")` for a bundler to
trip over. It still runs under node, because the only reason the glue would
touch a filesystem is to locate its `.wasm`, and every caller here hands it an
already compiled `WebAssembly.Module` through `instantiateWasm`.

`-sEXPORTED_FUNCTIONS=_main,_fflush` is the one that is easy to miss. libf2c
writes unit 6 through a buffered `FILE*`, and with `EXIT_RUNTIME` off nothing
flushes it when `main` returns, so **the listing is silently truncated at the
last buffer boundary** — water PM3 came back as 11,619 of 11,915 bytes, losing
the whole final geometry block, with no error anywhere. Every caller must run
`_fflush(0)` after `callMain` and before reading the file.

**One module carries all three Hamiltonians.** MNDO, AM1 and PM3 are keywords in
the input deck, not build options; `scripts/verify.mjs` runs all three through
the same `mopac7.wasm`.

### Optimisation levels

Every level below was verified to produce **identical numbers** — all 306
occupied valence levels of the 42 verification decks, bit for bit.

| `--opt`            |    wasm raw |        gzip |      brotli |       water |     benzene | naphthalene |    caffeine |   ibuprofen |
| ------------------ | ----------: | ----------: | ----------: | ----------: | ----------: | ----------: | ----------: | ----------: |
| `O3`               |     990,691 |     353,710 |     291,189 |     0.54 ms |     1.65 ms |     3.28 ms |     6.60 ms |     9.64 ms |
| `O2`               |     967,894 |     342,751 |     286,123 |     0.52 ms |     1.85 ms |     3.19 ms |     6.43 ms |     9.47 ms |
| **`Os` (default)** | **792,215** | **306,481** | **257,703** | **0.55 ms** | **2.11 ms** | **3.54 ms** | **6.46 ms** | **9.45 ms** |
| `Oz`               |     773,557 |     293,250 |     246,684 |     0.55 ms |     1.99 ms |     3.70 ms |     8.86 ms |     9.92 ms |

The `O3`, `O2` and `Oz` rows were measured before `_fflush` joined
`EXPORTED_FUNCTIONS`, which adds four bytes to the module, and before
`patches/fortran/0009`, which adds 796 bytes raw, 200 gzip and **saves** 333
brotli; only the `-Os` row has been re-measured since, and its sizes also carry
`0010` (the `ALLVEC` keyword), `0011` (`SIZES` 64/56) and `0012` (the `NHCO`
bound), which between them add 1,872 bytes raw and 596 brotli. None of the five
timing decks carries `ALLVEC` or `DEBUG`, so `0010` does not touch them. Patch 0009 adds one N-element norm and one N-element
scaled copy per eigenvector against an O(N**3) Householder reduction, and no
run-time difference was resolvable: interleaved in one process, 101 samples per
arm, best-of, at load average 7.9, water was 0.59 ms against 0.59, benzene
1.36 against 1.36 and ibuprofen 8.95 against 9.00. The timings are node 26 on an 8-core arm64 Mac, best
of 15 runs, one fresh module instance per run, clock over `callMain` only. **Best of**, not median: the calculation is
deterministic, so the spread is scheduler noise and the fastest sample is the
one least contaminated by it — medians on the same runs moved by up to 40 % with
background load, while the best-of figures reproduced to within 0.15 ms on a
re-run at load average 20. Cold start, once `instantiateWasm` feeds the glue an
already compiled module, is 1.3 ms to import the glue, 1.4 ms to compile the
binary and 2.9 ms for the first instance; every later instance costs 0.5 ms.

`-Os` is the default: **20 % smaller raw and 12 % smaller brotli than `-O3`**,
for 1 % on caffeine and 3 % on ibuprofen. `-Oz` buys another 4 % of brotli but
costs 34 % on caffeine, which is the wrong way round for a package that
computes.

## The pipeline

1. **f2c** — `barak/f2c` at a pinned commit, built with the host `cc`. It
   reports version `20240504`, and the build fails if it reports anything else.
2. **libf2c** — netlib's `libf2c.zip`, pinned by `sha256`. netlib publishes no
   version and no tag, so the checksum _is_ the version. `arith.h` is generated
   by compiling netlib's `arithchk.c` **to wasm and running it under node**,
   because it has to describe the target's floating point, not the host's.
3. **MOPAC 7.00** — `openmopac/MOPAC-archive` at a pinned commit, sparse-checked
   out to `1993_MOPAC7/` (8 MB fetched, not the 669 MB repository). The build
   checks the file count, a `sha256` over the whole subtree, and that the
   public-domain notice is still in `mopac.f`.
4. **patches/fortran/** — eleven changes to the Fortran, each documented in its
   own file. See below.
5. **f2c** — `-A -E -ec -I. -w`. Every flag is load-bearing and the reasons are
   in `scripts/build-wasm.sh`; the one to remember is that `-a` (automatic
   locals) makes MOPAC 7 **segfault**, natively and in wasm, because it relies
   on F77 static/SAVE semantics throughout.
6. **patches/c/** — one change to the generated C.
7. **`scripts/check-commons.mjs`** — makes every COMMON block as large as its
   largest declaration. See "Why this is not just f2c plus emcc".
8. **emcc** — every `.c`, plus `patches/shim.c`.
9. **link** — after dropping the COMMON objects that MOPAC's own `BLOCK DATA`
   also defines. Which ones those are is _computed_ with `emnm`, never
   hard-coded; there are 20.

### Things that fail silently, and are therefore checked

- **f2c exits 0 even when it prints `Error on line N of x.f`** and writes a
  truncated translation unit. The build greps its output.
- **`wasm-ld` only warns about a function signature mismatch** and then links a
  trapping stub, so the module dies at run time with a bare
  `RuntimeError: unreachable` and no message at all. Every warning is fatal here.
- **`-fcommon` does not exist on wasm** (`common symbols are not yet implemented
for Wasm`), which is why `f2c -E -ec` is mandatory.
- **A COMMON block declared with two different layouts** silently corrupts
  memory. See below — this is the one that cost the most.

## Why this is not just f2c plus emcc

MOPAC 7.00 as published in 1993 has four real COMMON-block defects, all of which
J. J. P. Stewart fixed in MOPAC 7.01. They do not show up as crashes; they show
up as **wrong chemistry on anything larger than about five atoms**, and only on
some targets, because what an out-of-bounds write lands on depends on how the
linker ordered the blocks. Before the patches, a native build and a wasm build
of the _identical_ C disagreed: MNDO ethene came out at 15.99 kcal/mol natively
and **273.90 kcal/mol** in wasm.

They were found by building the whole program with
`emcc -fsanitize=address` (which works, and is worth remembering), and then by
`scripts/check-commons.mjs`, which compiles every COMMON struct f2c emits and
compares `sizeof` file by file. That static check now runs on every build, so a
regression of this class fails the build instead of quietly changing a heat of
formation.

`patches/fortran/0005`, `0006` and `0007` carry the details, with the exact
sanitizer and f2c messages.

## The patches

| file                                              | what it fixes                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fortran/0001-ef-flush-extension.patch`           | `ef.f` both declares a COMMON block called FLUSH and calls a subroutine called FLUSH; f2c refuses the file, and libf2c's `flush_()` takes no argument                                                                                                                                              |
| `fortran/0002-ef-limscf-logical.patch`            | `LIMSCF` is used as a LOGICAL in `EFSTR` without being declared one; f2c: `impossible conversion`                                                                                                                                                                                                  |
| `fortran/0003-second-argument-count.patch`        | `SECOND(1)` against `FUNCTION SECOND()` in 8 places                                                                                                                                                                                                                                                |
| `fortran/0004-consts-argument-count.patch`        | `CALL CONSTS(COORD,.TRUE.)` against `SUBROUTINE CONSTS(COORD)`                                                                                                                                                                                                                                     |
| `fortran/0005-makpol-common-block-types.patch`    | **real defect**: `makpol.f` leaves `SIMBOL` and `LTXT` to the implicit rules, so two COMMON blocks have a different layout there than everywhere else, and `/SIMBOL/` is 360 bytes short on every run                                                                                              |
| `fortran/0006-symtrz-s00002-nadim.patch`          | **real defect**: ten of thirteen `/S00002/` declarations in `symtrz.f` omit `NADIM`, shifting every later member by one slot; the symptom is `MOLECULAR POINT GROUP : ????`                                                                                                                        |
| `fortran/0007-common-block-layout.patch`          | **real defect**: `/SYMOPS/`, `/SCRACH/` and `/SYMRES/` each declared two ways                                                                                                                                                                                                                      |
| `c/0008-cdiag-conflicting-prototypes.patch`       | `cdiag.f`'s deliberate COMPLEX/REAL storage aliasing becomes `error: conflicting types` in one translation unit                                                                                                                                                                                    |
| `fortran/0009-hqrii-degenerate-eigenvector.patch` | **real defect**: `HQRII`'s inverse iteration returns the same direction for both roots of a degenerate pair, the re-orthogonalisation then empties the second one, and the `1.D-24` floor in the normalisation hides it; the symptom is an all-zero eigenvector column and a `????` symmetry label |
| `fortran/0010-wrtkey-allvec.patch`                | `matou1.f` implements the `ALLVEC` keyword and `wrtkey.f` never lists it, so the only way to print the whole eigenvector matrix was to add `DEBUG` as well — which is also what arms `iter.f`'s dump of that matrix on every SCF cycle, 22.2 MiB of it on paclitaxel                               |
| `fortran/0011-sizes-64-56.patch`                  | `MAXHEV=64, MAXLIT=56` in `SIZES`: the smallest round pair that holds paclitaxel (62 heavy, 51 hydrogens, 299 orbitals), against the archive's 30/30                                                                                                                                               |
| `fortran/0012-nhco-bound.patch`                   | **real defect**: `moldat.f` fills `NHCO(4,20)` in COMMON `/MOLMEC/` two entries per amide N-H with no bound check, so the eleventh amide writes over `NNHCO` itself; the symptom is a heat of formation four thousand kcal/mol out, silently                                                       |
| `shim.c`                                          | `fdate_` and `myflsh_`, which libf2c does not have, and int-returning wrappers for `s_copy` / `s_cat` / `getenv_`, which libf2c declares `void` while f2c generates `int` callers                                                                                                                  |

`shim.c` wraps the three libf2c routines by compiling them under private names
(`-Ds_copy=s_copy_impl`) rather than patching libf2c, so a netlib refresh of
`libf2c.zip` cannot silently defeat it.

## Verification

`node scripts/verify.mjs` runs three checks and exits non-zero on any failure.

1. **water / AM1**, one deck, against the values recorded when this was first
   proved out: heat of formation exactly `-59.17072` kcal/mol and ionisation
   potential exactly `12.44564` eV.
2. **42 decks** — MNDO, AM1 and PM3 over 14 molecules — against
   `verification/reference-mopac7.json`. Worst difference over all 306 occupied
   valence levels: **0.000000 eV**. All 42 heats of formation and all 42
   ionisation potentials match to the last printed digit, as do all 42 point
   groups. The reference was produced by a _different_ program — MOPAC **7.01**,
   from the Ghemical packaging — so this is a cross-version check, not a
   self-comparison, and MOPAC 7 prints eigenvalues to three decimals, which is
   the resolution of the comparison.
3. **wasm against native**, from the identical f2c output, on the same 42 decks,
   compared block by block through the package's own parser: the worst absolute
   difference is **exactly zero** for the heat of formation, the ionisation
   potential, the total, electronic and core–core energies, every orbital
   energy, every Mulliken charge, every electron density, the dipole, the
   geometry, the point group and every coefficient of a non-degenerate orbital.

Two differences between the builds remain, and `scripts/verify.mjs` prints both
rather than hiding them:

- **Eigenvector phase** — an overall sign per column, which is arbitrary and
  carries no information. For water at AM1 the two listings differ on 55 lines,
  all of them coefficient rows, with 3 of the 6 columns turned over and every
  magnitude equal. `src/output/normalizeOrbitalPhases.ts` removes this from the
  parsed result by making each orbital's largest coefficient positive.
- **The mixture inside a degenerate set**, which no phase convention can pin
  because only the set is defined, not its members. Degenerate coefficients
  differ by up to **1.3** between the builds. `verify.mjs` reports that as a
  NOTE, and fails on any coefficient difference outside a degenerate set.

What is no longer a difference is an **empty eigenvector**. A normalised vector
cannot be all zero, so one is not a rotation of anything, and `verify.mjs` now
fails on one wherever it appears, in either build. MOPAC 7's own `HQRII`
produces them: over a 201-point bond-length scan of HF, HCl, N<sub>2</sub> and
CO under all three methods — 2412 geometries through each build — the unpatched
wasm lost a vector at 146 of them and an unpatched native build of the identical
C at 43, and the independent MOPAC 7.01 binary prints the same empty column at
AM1 HF r = 1.05 Å. The two targets differ only in which geometries fall in,
because arm64 clang contracts `a*b+c` into `fmadd` in the Householder reduction
while the wasm MVP has no f64 FMA opcode, so the last bits of the tridiagonal
differ and a different pivot is taken; the hole in the algorithm is the same on
both. `patches/fortran/0009-hqrii-degenerate-eigenvector.patch` closes it, and
the scan is 0 of 2412 on each target afterwards. Of the 42 verification decks,
39 produce a byte-identical listing across that patch and the 3 that change are
the three hydrogen-fluoride decks, each of which had an all-zero column.

The set itself is checked, not just its members. Over the 70 degenerate sets of
the 42 decks, the projector onto each set, `P = sum_k v_k v_k^T`, is built from
both builds and compared element by element: worst `|P_wasm - P_native|` is
**1.3e-4** after the patch and **1.0** before it, and the worst
`|<v_i,v_j> - delta_ij|` inside a set, on either build, is **2.4e-4** after and
**1.0** before. 1.3e-4 is the resolution of the comparison, because MOPAC prints
coefficients to four decimals. So the two builds do span the same subspace and do
carry an orthonormal basis of it; only the rotation inside differs.

The whole program also builds and runs under `emcc -fsanitize=address`, and
reports **nothing** on any of the 47 decks in `verification/`.

### A trap in the native build worth knowing about

netlib's `f2c.h` says

```c
typedef long int integer;
```

which is right on wasm32, where `long` is 32 bits, and **wrong on any LP64
host**, where it silently gives Fortran `INTEGER*8`. Arithmetic still works, so
it hides; but every Hollerith constant and every EQUIVALENCE that overlays
CHARACTER on INTEGER is then laid out differently. In MOPAC 7 the visible
consequence is that `symtrz.f`'s packed point-group table never matches, and a
naive native build prints `MOLECULAR POINT GROUP : ????` for every molecule
while getting all the energies right. `scripts/build-native.sh` narrows the
integer types for the host build so the A/B compares like with like.

The wasm build is unaffected — it is the one where the stock header is correct.

`verification/decks/` holds the 42 decks; `verification/timing/` the five used
by `scripts/bench.mjs`. Both are plain MOPAC input, readable and editable.

## Limits inherited from the source

`SIZES` carries `MAXHEV=64, MAXLIT=56`, so at most **64 non-hydrogen atoms and
56 hydrogens**, 120 atoms and a 312-orbital basis. The archive ships `30, 30`,
which stops at caffeine; 64/56 is the smallest round pair that holds paclitaxel
(62 + 51, 299 orbitals), and `patches/fortran/0011-sizes-64-56.patch` is the
whole change — every other bound in `SIZES` is derived from those two.

Measured through this pipeline, with the same patches on both sides so that
`SIZES` is the only variable:

|                           |                 30/30 |                     64/56 |      delta |
| ------------------------- | --------------------: | ------------------------: | ---------: |
| `mopac7.wasm`, raw        |               790,447 |                   791,972 | **+1,525** |
| `mopac7.wasm`, gzip -9    |               306,266 |                   306,491 |       +225 |
| `mopac7.wasm`, brotli -11 |               257,557 |                   257,548 |     **−9** |
| declared initial memory   | 1007 pages, 62.94 MiB | 1399 pages, **87.44 MiB** | +24.50 MiB |
| maximum memory            |                 2 GiB |                     2 GiB |          — |

MOPAC's arrays are uninitialised COMMON, so they live in `.bss` and never
appear in the binary: the download does not move and the declared memory does.
That is address space rather than residency — the pages a run never touches
never fault in, and a bare paclitaxel single point peaks at 119 MiB of process
memory against a 79 MiB empty node — but it is address space the module asks
for at every instantiation, and `runMopac7Job` builds a fresh instance per
call. 80/80 would declare 108 MiB and 90/120 137 MiB, both past where a small
phone is comfortable, and neither holds a molecule anyone asked for.

The numbers are the same on both sides of that change. The 42 verification
decks produce **byte-identical listings** at 30/30 and 64/56 but for the
timestamp and the `030BY030`/`064BY056` banner, and the 64/56 module matches a
native build of the 30/30 C to **exactly zero** on every field `verify.mjs`
compares.

Raising `SIZES` further is still a one-line change, but do not reach for it to
make a molecule "work": it also moves where any remaining out-of-bounds write
lands, which is exactly how this class of bug hides. The Ghemical packaging of
7.01 ships `60, 60`, and that alone made the ethene bug above disappear without
fixing it.
