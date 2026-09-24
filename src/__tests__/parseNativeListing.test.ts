/**
 * The parser has to read a listing that no WebAssembly run produced, because
 * `parseMopac7Output` is documented as parsing a native MOPAC 7 run too.
 */
import { expect, test } from 'vitest';

import { parseMopac7Output } from '../output/parseMopac7Output.ts';

import { listing } from './listing.ts';

test('hydrogen cyanide: a native listing, nine roots in a group of eight and one', () => {
  // This fixture is NOT from the WebAssembly build: it is the listing this
  // repository's native build of the same translated C produced, which is also
  // what the README means by "parses a native MOPAC 7 run too". Every value
  // below is what an independent MOPAC 7.01 (Ghemical) prints for the same deck.
  const result = parseMopac7Output(listing('hydrogen-cyanide-am1-native.out'));

  expect(result.version).toBe('7.00');
  expect(result.elements).toStrictEqual(['H', 'C', 'N']);
  expect(result.pointGroup).toBe('C*V');
  expect(result.heatOfFormation).toBe(31.04794);
  expect(result.ionizationPotential).toBe(13.72705);
  expect(result.filledLevels).toBe(5);
  // Nine orbitals: MOPAC prints eight per group, so the ninth is a group of one
  // whose eigenvalue sits under a blank line.
  expect(result.orbitals).toHaveLength(9);
  expect(result.orbitals.map((orbital) => orbital.energy)).toStrictEqual([
    -36.722, -21.377, -13.984, -13.727, -13.727, 1.747, 1.747, 3.073, 6.445,
  ]);
  expect(result.orbitals.at(-1)).toStrictEqual({
    index: 8,
    energy: 6.445,
    occupancy: 0,
    symmetry: '5SI',
  });
  // That lone ninth column, non-degenerate, read in full.
  expect(Array.from(result.coefficients.slice(8 * 9, 9 * 9))).toStrictEqual([
    0.2481, 0.2453, 0.6789, 0, 0, -0.2887, 0.5779, 0, 0,
  ]);
  expect(Array.from(result.charges)).toStrictEqual([0.237, -0.1908, -0.0462]);
  expect(Array.from(result.electronDensities)).toStrictEqual([
    0.763, 4.1908, 5.0462,
  ]);
  expect(result.dipole).toStrictEqual({
    x: -2.349,
    y: 0,
    z: 0,
    total: 2.349,
  });
  expect(Array.from(result.coordinates)).toStrictEqual([
    -1.0947, 0, 0, -0.0307, 0, 0, 1.1253, 0, 0,
  ]);
});
