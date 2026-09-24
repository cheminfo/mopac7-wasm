/**
 * The array bounds MOPAC 7 was compiled with, as `wasm/BUILD.json` records
 * them under `limits`.
 *
 * MOPAC sizes every one of its COMMON arrays from two numbers in its `SIZES`
 * include file, `MAXHEV` and `MAXLIT`, and derives the rest:
 * `NUMATM = MAXHEV + MAXLIT` and `MAXORB = 4 * MAXHEV + MAXLIT`. The 1993
 * archive ships `MAXHEV=30, MAXLIT=30`, which is 60 atoms and a 150-orbital
 * basis; this build raises it to `64, 56` through
 * `patches/fortran/0011-sizes-64-56.patch`, the smallest round pair that holds
 * paclitaxel (62 heavy atoms, 51 hydrogens, 113 atoms, 299 orbitals).
 *
 * These are checked before a deck is built, because MOPAC's own overflow
 * message is far less readable than a thrown error — and one of the ways it
 * overflows is silent.
 *
 * `src/__tests__/wasmPayload.test.ts` asserts these against `wasm/BUILD.json`,
 * so rebuilding with a different `SIZES` cannot leave them stale.
 */
export const MOPAC7_LIMITS = {
  /** `MAXHEV`: the most non-hydrogen atoms MOPAC can hold. */
  maxHeavyAtoms: 64,
  /** `MAXLIT`: the most hydrogen atoms MOPAC can hold. */
  maxHydrogenAtoms: 56,
  /** `NUMATM`: the most atoms of any kind, dummy atoms included. */
  maxAtoms: 120,
  /** `MAXORB`: the most atomic orbitals, so the largest basis. */
  maxOrbitals: 312,
} as const;
