# mopac7-wasm

[![NPM version](https://img.shields.io/npm/v/mopac7-wasm.svg)](https://www.npmjs.com/package/mopac7-wasm)
[![npm download](https://img.shields.io/npm/dm/mopac7-wasm.svg)](https://www.npmjs.com/package/mopac7-wasm)
[![license](https://img.shields.io/npm/l/mopac7-wasm.svg)](https://github.com/cheminfo/mopac7-wasm/blob/main/LICENSE)

MOPAC 7, the 1993 public-domain semi-empirical molecular orbital program by
James J. P. Stewart, compiled to WebAssembly. MNDO, MINDO/3, AM1 and PM3, with
heats of formation, orbital energies, symmetry labels, molecular orbital
coefficients and Mulliken charges, in node and in the browser.

This is not a reimplementation. It is MOPAC 7.00 unchanged in its physics: the
same Fortran, translated to C and compiled. Against a native build of that very
C it reproduces every energy, charge, dipole and coordinate exactly;
[Provenance](#provenance) says what "exactly" covers, and names the one place it
does not.

## Why it exists

Drawing a molecular orbital in a browser needs orbital energies that are close
to reality and a wavefunction to draw. A study of the methods that a browser can
run, scored against 50 experimental photoelectron bands over 14 molecules, put
MOPAC's NDDO hamiltonians ahead of everything else available:

| method                                           | mean absolute error | download |
| ------------------------------------------------ | ------------------- | -------- |
| MNDO, this package                               | 0.69 eV             | 0.3 MB   |
| AM1 / PM3, this package                          | 0.78 eV             | 0.3 MB   |
| Extended Hückel, as `lcao.cheminfo.org` ships it | 1.45 eV             | ~9 KB    |
| GFN2-xTB, through `@peterspackman/occjs`         | 1.57 eV             | 5.4 MB   |

(50 bands over 14 molecules, from the cheminfo lcao photoelectron reference set;
the mean absolute error is taken over the bands without any fitted shift. The
two comparators are the same study's rows for the model `lcao.cheminfo.org`
currently ships and for GFN2-xTB through `@peterspackman/occjs`.)

Cost, on node 26 / arm64, 8 cores. The embedded module is decoded and compiled
once per JavaScript realm — 1.7 ms to compile, 3.2 ms for the first
instantiation and 0.5 ms for every one after — so a calculation is an
instantiation plus MOPAC's own run. `node scripts/bench.mjs --repeats 21` clocks
that run at **0.43 ms for water, 1.61 ms for benzene, 3.24 ms for naphthalene,
6.57 ms for caffeine and 9.63 ms for ibuprofen** (best of 21; medians 0.62,
3.40, 3.46, 7.66 and 10.61 ms). End to end, `npm run benchmark` puts a whole
`mopac7()` call on water at **1.71–1.97 ms** over three runs of ~390 samples
each (±3 %), and the same call with nothing cached at **10.6–11.2 ms**, so
caching the compiled module is worth **5.6–6.6x**.

Those were measured on a machine that was not idle: the one-minute load average
ran between 4.2 and 7.6 on its 8 cores while the benchmark was running. Every
absolute timing above is therefore an upper bound, and the ratio is the figure
to rely on.

## Installation

```console
npm i mopac7-wasm
```

## Usage

```js
import { mopac7 } from 'mopac7-wasm';

const result = await mopac7({
  elements: ['O', 'H', 'H'],
  coordinates: [
    [0, 0.066772, 0],
    [0.763466, -0.529952, 0],
    [-0.763466, -0.529952, 0],
  ],
  method: 'AM1',
});

result.heatOfFormation; // -59.17072 kcal/mol
result.ionizationPotential; // 12.44576 eV
result.pointGroup; // 'C2V'
result.orbitals[3]; // { index: 3, energy: -12.446, occupancy: 2, symmetry: '1B1' }
result.basis[3]; // { atomIndex: 0, element: 'O', type: 'Pz' }

// The coefficient of atomic orbital `ao` in molecular orbital `mo`.
const { basis, coefficients } = result;
const homo = 3;
coefficients[homo * basis.length + 3]; // 1, the out-of-plane oxygen lone pair
```

Coordinates are in ångström, energies in eV and the heat of formation in
kcal/mol, exactly as MOPAC prints them.

### Orbital phases are pinned, and the listing's are not used

An eigenvector is only defined up to its sign: `c` and `-c` are the same orbital,
and which one a diagonaliser lands on depends on rounding inside its sweeps. Two
builds of the same MOPAC really do disagree — on water at AM1, a native build of
this repository's own translated C and the WebAssembly build print opposite signs
for three of the six columns, every magnitude identical. Anything that colours a
lobe by phase would flip with the build, so `result.coefficients` does not carry
the listing's signs:

> **every molecular orbital is turned so that its largest-magnitude coefficient
> is positive**, and when several coefficients tie at that magnitude the earliest
> atomic orbital decides.

Water's 1B1 lone pair therefore comes back as `+1` on O 2p<sub>z</sub> whichever
sign the listing happened to print, and this package's water coefficients are
byte-identical to an independent MOPAC 7.01's under the same convention.

A degenerate set is not covered by this, and cannot be: its members are only
defined up to a rotation of the set. See [What it does not
do](#what-it-does-not-do).

### Bundlers and workers

There is nothing to configure, anywhere. The WebAssembly binary lives inside the
JavaScript — gzipped, base64-encoded and decoded with `DecompressionStream` —
so there is no `.wasm` file to serve, no `locateFile`, no `vite-plugin-wasm`, no
`experiments.asyncWebAssembly` and no asset rule. The cost is the payload and
the glue — 473 kB of bundle, 327 kB gzipped over the wire — plus a few
milliseconds of decoding and compiling, once per JavaScript realm.

`compileMopac7()` returns the cached `WebAssembly.Module`, which is
structured-cloneable: compile it once on the main thread, `postMessage` it to
every worker, and each one instantiates it in well under a millisecond.

## API

| export                       | what it does                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `mopac7(options)`            | atoms in, a parsed `Mopac7Result` out; throws a `Mopac7Error` on failure                          |
| `buildMopac7Input(options)`  | atoms in, a MOPAC deck out; no WebAssembly involved                                               |
| `runMopac7Job(input)`        | a deck in, `{ input, listing, diagnostics, exitCode }` out; never throws for MOPAC's own failures |
| `parseMopac7Output(listing)` | a listing in, a `Mopac7Result` out; parses a native MOPAC 7 run too, and pins the orbital phases  |
| `compileMopac7()`            | the cached `WebAssembly.Module`, for warming and for workers                                      |
| `MOPAC7_ELEMENTS`            | the elements each hamiltonian is parameterised for                                                |
| `MOPAC7_LIMITS`              | the array bounds this build was compiled with                                                     |
| `Mopac7Error`                | carries `code`, and the deck and listing that produced the failure                                |

`Mopac7Error.code` is one of `'input'`, `'keywords'`, `'geometry'`,
`'parameters'`, `'scf'`, `'aborted'` or `'parse'`. A run that did not reach
self-consistency throws rather than returning orbital energies nobody should
use.

Every instance is discarded after one calculation, and that is not a choice:
MOPAC 7 is Fortran 77 whose whole state lives in `SAVE`d COMMON blocks, so a
second run in the same instance inherits the first one's converged density. The
module is compiled once and reused, which is where all the speed is — the
benchmark measures the difference at 5.6–6.6x.

## What it does not do

- **At most 30 non-hydrogen atoms and 30 hydrogens** (150 atomic orbitals), the
  bounds MOPAC's own `SIZES` file was compiled with. Larger molecules are
  refused before the module is touched; `MOPAC7_LIMITS` carries the numbers.
- **Restricted (RHF) only.** `spin` writes MOPAC's multiplicity keyword and
  MOPAC then runs its RHF half-electron treatment, which is a real open-shell
  calculation: a triplet O<sub>2</sub> comes out 27.4 kcal/mol below the singlet.
  There is no unrestricted option — `keywords: ['UHF']` is refused with
  `code: 'input'`, because a UHF listing carries separate alpha and beta
  eigenvector blocks and no `NO. OF FILLED LEVELS`, which is not a shape
  `Mopac7Result` has.
- **Inside a degenerate set the individual orbitals are not reproducible.** Two
  builds may print different mixtures of, say, a π pair, because only the set is
  defined and not its members; the phase convention above cannot help. Over the
  42 verification decks the energies, charges and non-degenerate coefficients
  agree exactly between the WebAssembly and native builds while degenerate
  coefficients differ by as much as 1.3. What is _not_ arbitrary is the set
  itself: every vector is normalised, every set spans the same subspace on both
  builds, and every symmetry label matches. Read a degenerate level as a set
  (sum its densities), never as two named orbitals.
- **`keywords` entries are checked, not passed through.** One keyword per array
  entry, printable ASCII, no whitespace; `+` (MOPAC's second-keyword-line
  marker), `SETUP` and `UHF` are refused with `code: 'input'`. Without that, a
  keyword holding a newline would shift every line of the deck below it and
  MOPAC would silently read the wrong geometry.
- **The elements MOPAC 7 carries, and no more.** `MOPAC7_ELEMENTS` lists them
  per method — PM3 is the widest at 30 elements, MINDO/3 the narrowest at 10,
  and only PM3 has magnesium while only MNDO and AM1 have lithium. `Na` and `K`
  are sparkles in AM1 and PM3, not parameterised atoms; MOPAC says so itself in
  the listing.
- **No transition metals** beyond MNDO chromium and zinc, no dispersion, no
  solvation, no excited states through this API.
- **No wall-clock budget.** MOPAC's own `T=` limit reads a CPU clock that
  returns zero under WebAssembly, so a long optimisation cannot be cut short
  from inside. Run it in a worker if that matters.
- **Geometry optimisation is available** (`optimize: true`) but every number in
  this README is a single point, which is what the reference set scored.

MOPAC rebuilds the geometry through internal coordinates, so `result.coordinates`
is MOPAC's frame and not the one handed in: atom 1 at the origin, atom 2 on +x.
For one to three atoms the deck is a Z-matrix, because `getgeo.f` reads three
atoms or fewer that way whatever `XYZ` says; and when the first three atoms are
collinear a dummy `XX` atom is inserted to break the line, which MOPAC then
drops from every printed block.

## Provenance

The 156 Fortran-77 files come from the `1993_MOPAC7` directory of
[openmopac/MOPAC-archive](https://github.com/openmopac/MOPAC-archive) at commit
`ed31531`, checked by file count, by a tree digest and by the presence of its own
public-domain notice. They are translated to C with
[f2c](https://www.netlib.org/f2c/) 20240504, built from source, and compiled with
[Emscripten](https://emscripten.org/) against netlib libf2c. Eight small patches
are applied, each a file in `patches/` whose header quotes the exact compiler,
linker or sanitizer message it fixes: five are portability fixes and three are
genuine COMMON-block defects in MOPAC 7.00 that MOPAC 7.01 also fixed, found
here with AddressSanitizer and a static size check the build runs on every
block. Nothing in the hamiltonians, the parameters or the SCF is touched.

MOPAC 7.00 was written at the Frank J. Seiler Research Laboratory, United States
Air Force Academy, and distributed through the Quantum Chemistry Program
Exchange as QCPE program #688. It is the last open-source release of MOPAC:
every later version is commercial, and today's
[openmopac/mopac](https://github.com/openmopac/mopac) is Apache-2.0. MOPAC 7
carries its own notice of public-domain status under 17 U.S.C. § 105 and prints
it on every run; it is reproduced verbatim in [LICENSE](./LICENSE) as that notice
requires.

MOPAC 7 also incorporates work by A. Klamt (COSMO solvation), David Danovich
(Green's-function ionisation potentials), W. Thiel (a routine from QCPE 438,
MNDOC), Peter L. Cummins, Daniel Liotard and S. Olivella, together with fifteen
netlib LAPACK 1.0b and reference BLAS routines.

Every build is checked against a native build of the same translated C on the
same input. `node scripts/verify.mjs` runs 42 decks — 14 molecules × 3 methods —
twice over, once through the WebAssembly module and once through
`build/native/mopac7`, parses both with this package's own parser and compares
every block it returns. Against `verification/reference-mopac7.json`, an
independent MOPAC 7.01 (the Ghemical packaging), the worst difference over all
306 occupied valence levels is 0.000000 eV. Against the native build of the very
same C, the worst absolute difference is **exactly zero** for each of: the heat
of formation, the ionisation potential, the total, electronic and core–core
energies, every orbital energy, every Mulliken charge, every electron density,
the dipole, the geometry, and every coefficient of a non-degenerate orbital.

The listings themselves are not identical, and the claim is deliberately not that
they are: for water at AM1 the two differ on 55 lines, all of them eigenvector
rows whose columns carry the opposite sign, and 3 of the 6 molecular orbitals are
affected with every magnitude equal. The phase convention removes that difference
from the parsed result. What it cannot remove is the mixture inside a degenerate
set, which `verify.mjs` prints as a note rather than a failure; see [What it does
not do](#what-it-does-not-do) for the consequence.

An empty eigenvector is a failure in `verify.mjs`, inside a degenerate set as
much as outside it, on either build: a normalised vector cannot be all zero, so
one is a diagonaliser that lost a direction rather than an arbitrary rotation.
MOPAC 7's HQRII does produce them — on a 2412-geometry bond-length scan of four
diatomics, the unpatched WebAssembly build lost a vector at 146 geometries and
an unpatched native build of the same C at 43, and an independent MOPAC 7.01
does the same — and
`patches/fortran/0009-hqrii-degenerate-eigenvector.patch` is what removes them:
0 of 2412 on both targets after it.

`wasm/BUILD.json` records the pins, the patches, the sizes and the digests, and
`src/__tests__/wasmPayload.test.ts` hashes what the committed payload
decompresses to on every test run.

## License

`MIT AND BSD-3-Clause AND HPND`. The TypeScript, the build scripts and the tests
are MIT; MOPAC itself is public domain, taken from an archive under
BSD-3-Clause; the bundled LAPACK and BLAS are BSD-3-Clause; libf2c carries the
AT&T / Lucent / Bellcore f2c notice. No copyright is claimed over any of them.
See [LICENSE](./LICENSE) for the full notices.

## How to cite

Cite the program and the method you used, not this package. A wrapper is not a
citable scientific contribution, and referees want the hamiltonian.

**The program**

> Stewart, J. J. P. MOPAC: A semiempirical molecular orbital program.
> _J. Comput.-Aided Mol. Des._ **1990**, _4_ (1), 1–103.
> [doi:10.1007/BF00128336](https://doi.org/10.1007/BF00128336)

MOPAC 7.00 (1993), QCPE program #688.

**The method**

| keyword  | citation                                                                                                                                                                                                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MNDO`   | Dewar, M. J. S.; Thiel, W. Ground states of molecules. 38. The MNDO method. Approximations and parameters. _J. Am. Chem. Soc._ **1977**, _99_, 4899–4907. [doi:10.1021/ja00457a004](https://doi.org/10.1021/ja00457a004)                                                                                        |
| `AM1`    | Dewar, M. J. S.; Zoebisch, E. G.; Healy, E. F.; Stewart, J. J. P. Development and use of quantum mechanical molecular models. 76. AM1: a new general purpose quantum mechanical molecular model. _J. Am. Chem. Soc._ **1985**, _107_, 3902–3909. [doi:10.1021/ja00299a024](https://doi.org/10.1021/ja00299a024) |
| `PM3`    | Stewart, J. J. P. Optimization of parameters for semiempirical methods. I. Method. _J. Comput. Chem._ **1989**, _10_, 209–220. [doi:10.1002/jcc.540100208](https://doi.org/10.1002/jcc.540100208) — and II. Applications, _ibid._ 221–264.                                                                      |
| `MINDO3` | Bingham, R. C.; Dewar, M. J. S.; Lo, D. H. Ground states of molecules. XXV. MINDO/3. _J. Am. Chem. Soc._ **1975**, _97_, 1285–1293 (and 1294, 1302, 1307). [doi:10.1021/ja00839a001](https://doi.org/10.1021/ja00839a001)                                                                                       |

MOPAC prints the parameter reference for **every element** in the run, and
several elements were parameterised in later papers than the four above — MNDO
aluminium credits L. P. Davis et al., MNDO chlorine credits Dewar and Rzepa, and
AM1 lithium is "TAKEN FROM MNDOC BY W. THIEL". Quote the lines your own output
printed, not a static table.

If you want to say where the binary came from, mention this package in the
methods text ("MOPAC 7.00 compiled to WebAssembly, `mopac7-wasm` vX.Y.Z") rather
than in the bibliography.

## Rebuilding the WebAssembly

The binary is committed, because building it needs f2c built from source,
emscripten, and a translation of 156 Fortran files — an hour of toolchain, not a
postinstall step. To rebuild it:

```console
npm run build-wasm            # -Os by default; --opt O3 for the fast build
npm run verify-wasm           # 42 decks against the reference and the native build
node scripts/bench.mjs        # cold init and per-deck timings
```

`npm run verify-wasm` needs no build: when the raw linker output (`wasm/mopac7.mjs`,
`wasm/mopac7.wasm`, both gitignored) is absent it runs the committed `wasm/glue.js`
and embedded payload instead, which is what the published package runs. The
wasm-against-native check needs `build/native/mopac7` and says so when it is
missing.

[BUILD.md](./BUILD.md) documents the pipeline, the pins, the patches and the
three silent failure modes the script turns into hard errors. `--native` also
builds the same translated C with the host compiler, which is what the A/B check
compares against.
