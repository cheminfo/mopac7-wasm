import { expect, test } from 'vitest';

import { parseMopac7Output } from '../output/parseMopac7Output.ts';

import { catchMopac7Error } from './catchMopac7Error.ts';
import { EXPECTED } from './expected.ts';
import { listing } from './listing.ts';

test('water AM1: the summary block', () => {
  const result = parseMopac7Output(listing('water-am1.out'));

  expect(result.version).toBe('7.00');
  expect(result.converged).toBe(true);
  expect(result.terminationMessage).toBe(
    '1SCF WAS SPECIFIED, SO BFGS WAS NOT USED',
  );
  expect(result.heatOfFormation).toBe(EXPECTED.water.AM1.heatOfFormation);
  expect(result.totalEnergy).toBe(-348.55951);
  expect(result.electronicEnergy).toBe(-492.45267);
  expect(result.coreCoreRepulsion).toBe(143.89317);
  expect(result.ionizationPotential).toBe(
    EXPECTED.water.AM1.ionizationPotential,
  );
  expect(result.molecularWeight).toBe(18.015);
  expect(result.filledLevels).toBe(4);
  expect(result.pointGroup).toBe('C2V');
  // The wasm build has no working CPU clock, so MOPAC always reports zero.
  expect(result.computationTimeSeconds).toBe(0);
  expect(result.unknownKeywords).toStrictEqual([]);
});

test('water AM1: all six orbitals, not a window around the HOMO', () => {
  const result = parseMopac7Output(listing('water-am1.out'));

  expect(result.orbitals).toStrictEqual([
    { index: 0, energy: -36.288, occupancy: 2, symmetry: '1A1' },
    { index: 1, energy: -18.143, occupancy: 2, symmetry: '1B2' },
    { index: 2, energy: -14.906, occupancy: 2, symmetry: '2A1' },
    { index: 3, energy: -12.446, occupancy: 2, symmetry: '1B1' },
    { index: 4, energy: 4.341, occupancy: 0, symmetry: '3A1' },
    { index: 5, energy: 6.145, occupancy: 0, symmetry: '2B2' },
  ]);
});

test('water AM1: the basis and the coefficient matrix', () => {
  const result = parseMopac7Output(listing('water-am1.out'));

  expect(result.basis).toStrictEqual([
    { atomIndex: 0, element: 'O', type: 'S' },
    { atomIndex: 0, element: 'O', type: 'Px' },
    { atomIndex: 0, element: 'O', type: 'Py' },
    { atomIndex: 0, element: 'O', type: 'Pz' },
    { atomIndex: 1, element: 'H', type: 'S' },
    { atomIndex: 2, element: 'H', type: 'S' },
  ]);
  expect(result.coefficients).toHaveLength(36);
  // These are the coefficients an independent MOPAC 7.01 (the Ghemical
  // packaging) prints for this deck, run through the same phase convention:
  // identical to the last printed decimal, signs included.
  expect(Array.from(result.coefficients)).toStrictEqual([
    0.8975, 0.0933, 0.1194, 0, 0.2928, 0.2928, 0, 0.6067, -0.4742, 0, 0.4511,
    -0.4511, -0.3563, 0.4942, 0.6322, 0, 0.3385, 0.3385, 0, 0, 0, 1, 0, 0,
    -0.2597, -0.3554, -0.4547, 0, 0.5475, 0.5475, 0, -0.5027, 0.3929, 0, 0.5445,
    -0.5445,
  ]);
});

test('water AM1: the phase convention turns the columns the listing prints negative', () => {
  const result = parseMopac7Output(listing('water-am1.out'));
  const raw = rawColumn(listing('water-am1.out'), 3);

  // The 1B1 HOMO is the out-of-plane oxygen lone pair, a single coefficient on
  // O 2pz, and this listing prints it as -1. The result carries +1 whatever
  // sign the build happened to print.
  expect(raw).toStrictEqual([0, 0, 0, -1, 0, 0]);
  expect(Array.from(result.coefficients.slice(3 * 6, 4 * 6))).toStrictEqual([
    0, 0, 0, 1, 0, 0,
  ]);
  // Root 3 is the other flipped one: -.6322 is the largest coefficient.
  expect(rawColumn(listing('water-am1.out'), 2)).toStrictEqual([
    0.3563, -0.4942, -0.6322, 0, -0.3385, -0.3385,
  ]);
  expect(Array.from(result.coefficients.slice(2 * 6, 3 * 6))).toStrictEqual([
    -0.3563, 0.4942, 0.6322, 0, 0.3385, 0.3385,
  ]);
});

test('water AM1: charges, dipole and the geometry MOPAC worked in', () => {
  const result = parseMopac7Output(listing('water-am1.out'));

  expect(result.elements).toStrictEqual(['O', 'H', 'H']);
  expect(Array.from(result.charges)).toStrictEqual([-0.3848, 0.1924, 0.1924]);
  expect(Array.from(result.electronDensities)).toStrictEqual([
    6.3848, 0.8076, 0.8076,
  ]);
  expect(result.dipole).toStrictEqual({
    x: 1.147,
    y: 1.468,
    z: 0,
    total: 1.863,
  });
  expect(Array.from(result.coordinates)).toStrictEqual([
    -0.245, -0.3134, 0, 0.724, -0.3134, 0, -0.479, 0.6269, 0,
  ]);
});

test('benzene AM1: thirty orbitals across four printed root groups', () => {
  const result = parseMopac7Output(listing('benzene-am1.out'));

  expect(result.pointGroup).toBe('D6H');
  expect(result.heatOfFormation).toBe(EXPECTED.benzene.AM1.heatOfFormation);
  expect(result.ionizationPotential).toBe(
    EXPECTED.benzene.AM1.ionizationPotential,
  );
  expect(result.filledLevels).toBe(15);
  expect(result.orbitals).toHaveLength(30);
  expect(result.basis).toHaveLength(30);
  expect(result.coefficients).toHaveLength(900);

  const occupied = result.orbitals.slice(0, 15);

  expect(occupied.map((orbital) => orbital.energy)).toStrictEqual(
    EXPECTED.benzene.AM1.occupiedEnergies,
  );
  expect(occupied.map((orbital) => orbital.symmetry)).toStrictEqual(
    EXPECTED.benzene.AM1.symmetryLabels,
  );
  // Root 30 is the last of the fourth group, so the whole spectrum was read.
  expect(result.orbitals.at(-1)).toStrictEqual({
    index: 29,
    energy: 6.136,
    occupancy: 0,
    symmetry: '3B2U',
  });
});

test('benzene AM1: the basis runs six carbons then six hydrogens', () => {
  const result = parseMopac7Output(listing('benzene-am1.out'));

  expect(result.basis.slice(0, 4)).toStrictEqual([
    { atomIndex: 0, element: 'C', type: 'S' },
    { atomIndex: 0, element: 'C', type: 'Px' },
    { atomIndex: 0, element: 'C', type: 'Py' },
    { atomIndex: 0, element: 'C', type: 'Pz' },
  ]);
  expect(result.basis[24]).toStrictEqual({
    atomIndex: 6,
    element: 'H',
    type: 'S',
  });
  expect(result.basis.at(-1)).toStrictEqual({
    atomIndex: 11,
    element: 'H',
    type: 'S',
  });

  // The 1A2U orbital, root 11, is the lowest pi level: every carbon Pz at the
  // same value and nothing anywhere else. The listing prints -0.4082 in all six
  // places; the phase convention makes the whole column positive.
  const piLevel = Array.from(result.coefficients.slice(10 * 30, 11 * 30));

  expect(piLevel.filter((value) => value !== 0)).toStrictEqual([
    0.4082, 0.4082, 0.4082, 0.4082, 0.4082, 0.4082,
  ]);
  // The charges are an independent MOPAC 7.01 run's (Ghemical, runs7/MOPAC7-AM1).
  expect(result.charges).toHaveLength(12);
  expect(result.charges[0]).toBe(-0.1292);
  expect(result.charges[6]).toBe(0.1292);
});

test('a listing that stops before the SCF throws with the scf code', () => {
  const truncated = listing('water-am1.out').split(
    'SCF FIELD WAS ACHIEVED',
    1,
  )[0] as string;
  const error = catchMopac7Error(() => parseMopac7Output(truncated));

  expect(error.code).toBe('scf');
  expect(error.message).toContain('SCF FIELD WAS ACHIEVED');
});

test('a listing with no eigenvector block throws with the parse code', () => {
  const stripped = listing('water-am1.out')
    .split('\n')
    .filter((line) => !/^\s*EIGENVECTORS\s*$/.test(line))
    .join('\n');
  const error = catchMopac7Error(() => parseMopac7Output(stripped));

  expect(error.code).toBe('parse');
  expect(error.message).toContain('VECTORS');
});

test('an empty listing throws rather than returning zeroes', () => {
  const error = catchMopac7Error(() => parseMopac7Output(''));

  expect(error.code).toBe('scf');
});

/**
 * One column of the converged EIGENVECTORS block exactly as the listing prints
 * it, so a test can show what the phase convention changed.
 * @param text - The whole listing.
 * @param column - The 0-based root index, which must sit in the first printed group.
 * @returns The printed coefficients, top to bottom.
 */
function rawColumn(text: string, column: number): number[] {
  const lines = text.split('\n');
  let start = -1;
  for (let index = lines.length - 1; index >= 0; index--) {
    if (/^\s*EIGENVECTORS\s*$/.test(lines[index] as string)) {
      start = index;
      break;
    }
  }
  const values: number[] = [];
  for (let index = start; index < lines.length; index++) {
    const line = lines[index] as string;
    if (line.includes('NET ATOMIC CHARGES')) break;
    const row =
      /^\s*[A-Za-z][A-Za-z\d]*\s+[A-Za-z]{1,2}\s+\d+\s+(?<rest>.*)$/.exec(line)
        ?.groups?.rest;
    if (row === undefined) continue;
    values.push(Number(row.trim().split(/\s+/)[column]));
  }
  return values;
}
