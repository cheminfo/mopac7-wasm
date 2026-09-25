import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Mopac7AtomicOrbital, Mopac7Method } from '../../types.ts';

/** One hamiltonian and element, as OpenMOPAC 23 prints its valence shells. */
export interface Mopac23ExponentRow {
  method: Mopac7Method;
  element: string;
  /** `ATOM_PQN`. */
  principalQuantumNumber: number;
  /** `AO_ZETA` of the `S` row. */
  zetaS: number | null;
  /** `AO_ZETA` of the `PX` row, or `null` when the element has no p shell. */
  zetaP: number | null;
}

/** One molecule, with the geometry and atomic-orbital order MOPAC 23 used. */
export interface Mopac23OverlapJob {
  method: Mopac7Method;
  molecule: string;
  elements: string[];
  /** Ångström, flat, three per atom. */
  coordinates: number[];
  atomicOrbitals: Mopac7AtomicOrbital[];
  /** `OVERLAP_MATRIX`, MOPAC's packed lower triangle. */
  overlapLowerTriangle: number[];
}

/**
 * MOPAC 7 prints no `AO_ZETA`, no `ATOM_PQN` and no `OVERLAP_MATRIX`, so the only
 * independent check on the tables it keeps to itself is a program that does print
 * them. OpenMOPAC 23.2.5 does, in the input section of its `.aux` file and so
 * before the SCF, and it still carries the original MNDO, AM1 and PM3 parameter
 * sets. These two fixtures are its output, extracted by
 * `scripts/extract-mopac23-reference.mjs` from runs that are not in this
 * repository, which is why they are committed.
 *
 * MOPAC 23 dropped MINDO/3 entirely, so that hamiltonian has no external check;
 * `basisTables.test.ts` holds it to `block.f` instead.
 */
export const MOPAC23_EXPONENTS = readFixture('mopac23-exponents.json') as {
  provenance: { program: string };
  rows: Mopac23ExponentRow[];
};

/** The four molecules whose whole overlap matrix is kept, under three hamiltonians. */
export const MOPAC23_OVERLAPS = readFixture('mopac23-overlap.json') as {
  jobs: Mopac23OverlapJob[];
};

/** MOPAC 23 converts ångström to bohr with the CODATA value, so a comparison must too. */
export const CODATA_BOHR_PER_ANGSTROM = 0.529177210903;

/**
 * Read one committed fixture.
 * @param name - Its file name under `data/`.
 * @returns Its parsed contents.
 */
function readFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(import.meta.dirname, 'data', name), 'utf8'),
  );
}
