import { Mopac7Error } from '../Mopac7Error.ts';
import type { Mopac7AtomicOrbital, Mopac7Orbital } from '../types.ts';

import { FIELD_START, readNumbers, tryNumbers } from './fields.ts';
import { normalizeOrbitalPhases } from './normalizeOrbitalPhases.ts';

/** The molecular orbitals, their basis, and the coefficient matrix between them. */
export interface Mopac7Eigenvectors {
  orbitals: Mopac7Orbital[];
  basis: Mopac7AtomicOrbital[];
  coefficients: Float64Array;
}

/**
 * Read the final `EIGENVECTORS` block: every printed molecular orbital, its
 * energy and symmetry label, the atomic orbital basis, and the coefficient of
 * each atomic orbital in each molecular orbital.
 *
 * MOPAC prints the block in groups of up to eight roots, and — because
 * `ALLVEC` needs `DEBUG` to be accepted at all — it also dumps one
 * "EIGENVECTORS AND EIGENVALUES ON ITERATION n" matrix per SCF iteration
 * beforehand. Only the last block, the one headed by a bare `EIGENVECTORS`, is
 * the converged one.
 *
 * The coefficients are returned with their phases pinned by
 * {@link normalizeOrbitalPhases} — the largest coefficient of each orbital is
 * positive — so they do not carry the arbitrary column signs the listing
 * happens to have.
 * @param lines - The listing, split into lines.
 * @param filledLevels - MOPAC's `NO. OF FILLED LEVELS`, used to set the occupancies.
 * @returns The orbitals, the basis and the phase-normalised coefficient matrix.
 * @throws {Mopac7Error} With `code: 'parse'` when the block is missing or does not add up.
 */
export function parseEigenvectors(
  lines: readonly string[],
  filledLevels: number,
): Mopac7Eigenvectors {
  const start = findLastBlock(lines);
  const roots: number[] = [];
  const energies: number[] = [];
  const labels: Array<string | null> = [];
  const columns: number[][] = [];
  let basis: Mopac7AtomicOrbital[] | null = null;

  for (let index = start; index < lines.length; index++) {
    const line = lines[index] as string;
    if (line.includes('NET ATOMIC CHARGES')) break;
    const header = /^\s*Root No\.\s+(?<roots>\d+(?:\s+\d+)*)\s*$/.exec(line);
    if (header?.groups === undefined) continue;

    const group = (header.groups.roots ?? '').trim().split(/\s+/).map(Number);
    const energyIndex = findEnergyRow(lines, index, group.length);
    const groupEnergies = readNumbers(
      lines[energyIndex] as string,
      group.length,
    );
    const groupLabels = readLabels(lines, index, energyIndex, group.length);
    const { rows, atomicOrbitals } = readCoefficientRows(
      lines,
      energyIndex + 1,
      group.length,
    );

    if (basis === null) {
      basis = atomicOrbitals;
    } else if (!sameBasis(basis, atomicOrbitals)) {
      throw new Mopac7Error(
        'parse',
        'the atomic orbital order changed between eigenvector groups',
      );
    }

    for (let k = 0; k < group.length; k++) {
      roots.push(group[k] as number);
      energies.push(groupEnergies[k] as number);
      labels.push(groupLabels[k] ?? null);
      columns.push(rows[k] as number[]);
    }
  }

  if (basis === null || columns.length === 0) {
    throw new Mopac7Error(
      'parse',
      'the EIGENVECTORS block held no molecular orbitals',
    );
  }
  for (let index = 0; index < roots.length; index++) {
    if (roots[index] !== index + 1) {
      throw new Mopac7Error(
        'parse',
        `MOPAC printed root ${String(roots[index])} where root ${index + 1} was expected, so this is ` +
          'a window of the spectrum and not the whole of it; the deck needs the ALLVEC and DEBUG keywords',
      );
    }
  }

  const orbitals: Mopac7Orbital[] = [];
  const coefficients = new Float64Array(columns.length * basis.length);
  for (let mo = 0; mo < columns.length; mo++) {
    orbitals.push({
      index: mo,
      energy: energies[mo] as number,
      occupancy: mo < filledLevels ? 2 : 0,
      symmetry: labels[mo] ?? null,
    });
    const column = columns[mo] as number[];
    if (column.length !== basis.length) {
      throw new Mopac7Error(
        'parse',
        `orbital ${mo + 1} has ${column.length} coefficients for a basis of ${basis.length}`,
      );
    }
    for (let ao = 0; ao < column.length; ao++) {
      coefficients[mo * basis.length + ao] = column[ao] as number;
    }
  }
  normalizeOrbitalPhases(coefficients, basis.length);
  return { orbitals, basis, coefficients };
}

/** A coefficient row's label part: orbital type, element symbol, atom number. */
const AO_LABEL =
  /^\s*(?<type>[A-Za-z][A-Za-z\d]*)\s+(?<element>[A-Za-z]{1,2})\s+(?<atom>\d+)\s*$/;

function findLastBlock(lines: readonly string[]): number {
  for (let index = lines.length - 1; index >= 0; index--) {
    if (/^\s*EIGENVECTORS\s*$/.test(lines[index] as string)) return index;
  }
  throw new Mopac7Error(
    'parse',
    'the listing has no EIGENVECTORS block; the deck needs the VECTORS keyword',
  );
}

// The eigenvalue row is the first line under the header that reads as `count`
// numbers.
function findEnergyRow(
  lines: readonly string[],
  header: number,
  count: number,
): number {
  for (
    let index = header + 1;
    index < Math.min(header + 8, lines.length);
    index++
  ) {
    if (tryNumbers(lines[index] as string, count) !== null) return index;
  }
  throw new Mopac7Error(
    'parse',
    `no row of ${count} eigenvalues under "Root No."`,
  );
}

// Symmetry labels sit between the header and the eigenvalues, as `1 A1G`,
// separated by two or more spaces. MOPAC prints none when symtrz.f could not
// classify the orbitals, in which case the labels are simply absent.
function readLabels(
  lines: readonly string[],
  header: number,
  energyRow: number,
  count: number,
): Array<string | null> {
  for (let index = header + 1; index < energyRow; index++) {
    const line = lines[index] as string;
    if (!/[A-Za-z]/.test(line)) continue;
    const labels = line
      .trim()
      .split(/\s{2,}/)
      .map((piece) => piece.replaceAll(' ', ''));
    if (labels.length === count) return labels;
  }
  return Array.from({ length: count }, () => null);
}

function readCoefficientRows(
  lines: readonly string[],
  from: number,
  count: number,
): { rows: number[][]; atomicOrbitals: Mopac7AtomicOrbital[] } {
  const rows: number[][] = Array.from({ length: count }, () => []);
  const atomicOrbitals: Mopac7AtomicOrbital[] = [];
  for (let index = from; index < lines.length; index++) {
    const line = lines[index] as string;
    if (line.trim().length === 0) continue;
    const label = AO_LABEL.exec(line.slice(0, FIELD_START));
    if (label?.groups === undefined) break;
    const values = readNumbers(line, count);
    const { type, element, atom } = label.groups;
    if ([type, element, atom].includes(undefined)) {
      throw new Mopac7Error(
        'parse',
        `the coefficient row "${line.trim()}" has no atomic orbital label`,
      );
    }
    atomicOrbitals.push({
      atomIndex: Number(atom) - 1,
      element: element as string,
      type: type as string,
    });
    for (let k = 0; k < count; k++) {
      (rows[k] as number[]).push(values[k] as number);
    }
  }
  if (atomicOrbitals.length === 0) {
    throw new Mopac7Error(
      'parse',
      'an eigenvector group carried no atomic orbital rows',
    );
  }
  return { rows, atomicOrbitals };
}

function sameBasis(
  a: readonly Mopac7AtomicOrbital[],
  b: readonly Mopac7AtomicOrbital[],
): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    const left = a[index] as Mopac7AtomicOrbital;
    const right = b[index] as Mopac7AtomicOrbital;
    if (left.type !== right.type || left.element !== right.element) {
      return false;
    }
    if (left.atomIndex !== right.atomIndex) return false;
  }
  return true;
}
