/**
 * End-to-end coverage of the `charge` and `spin` options.
 *
 * Every literal here was produced by running the very deck `buildMopac7Input`
 * writes through TWO native MOPAC 7 binaries — this repository's own native
 * build of the translated C, and the independent Ghemical packaging of MOPAC
 * 7.01 — which agreed on every value below to the last printed decimal. None of
 * it is a recording of the WebAssembly build's own output.
 *
 * Coefficient columns are asserted only for non-degenerate orbitals. A
 * degenerate pair is defined up to a rotation inside its own subspace, which no
 * phase convention pins, and the two builds do mix such a pair differently —
 * hydroxide's 1PI level is the example.
 */
import { expect, test } from 'vitest';

import { mopac7 } from '../mopac7.ts';

import { EXTRA_MOLECULES, MOLECULES } from './molecules.ts';

test('charge: 1 removes an electron, one filled level and all', async () => {
  const result = await mopac7({ ...MOLECULES.water, charge: 1 });

  expect(result.filledLevels).toBe(3);
  expect(result.heatOfFormation).toBe(217.68869);
  expect(result.ionizationPotential).toBe(26.10435);
  expect(result.orbitals.map((orbital) => orbital.energy)).toStrictEqual([
    -47.74, -29.183, -26.205, -18.844, -6.108, -4.256,
  ]);
  expect(result.orbitals.map((orbital) => orbital.occupancy)).toStrictEqual([
    2, 2, 2, 0, 0, 0,
  ]);
  expect(Array.from(result.charges)).toStrictEqual([0.307, 0.3465, 0.3465]);
  expect(Array.from(result.electronDensities)).toStrictEqual([
    5.693, 0.6535, 0.6535,
  ]);
  // Root 3, the 2A1 HOMO of the cation, is not degenerate.
  expect(Array.from(result.coefficients.slice(2 * 6, 3 * 6))).toStrictEqual([
    -0.3231, 0.5235, 0.6698, 0, 0.2941, 0.2941,
  ]);
});

test('charge: -1 adds one, and hydroxide comes out as a closed shell', async () => {
  const result = await mopac7({ ...EXTRA_MOLECULES.hydroxide, charge: -1 });

  expect(result.filledLevels).toBe(4);
  expect(result.basis).toHaveLength(5);
  expect(result.pointGroup).toBe('C*V');
  expect(result.heatOfFormation).toBe(-13.98301);
  expect(result.ionizationPotential).toBe(0.88877);
  expect(result.orbitals.map((orbital) => orbital.energy)).toStrictEqual([
    -22.697, -5.488, -0.889, -0.889, 15.832,
  ]);
  expect(result.orbitals.map((orbital) => orbital.symmetry)).toStrictEqual([
    '1SI',
    '2SI',
    '1PI',
    '1PI',
    '3SI',
  ]);
  expect(Array.from(result.charges)).toStrictEqual([-1.0158, 0.0158]);
  expect(Array.from(result.electronDensities)).toStrictEqual([7.0158, 0.9842]);
});

test('spin: triplet is a different calculation on dioxygen, not a relabelling', async () => {
  const triplet = await mopac7({
    ...EXTRA_MOLECULES.dioxygen,
    spin: 'triplet',
  });
  const singlet = await mopac7(EXTRA_MOLECULES.dioxygen);

  expect(triplet.filledLevels).toBe(5);
  expect(triplet.heatOfFormation).toBe(-5.85447);
  expect(triplet.ionizationPotential).toBe(6.66797);
  expect(triplet.orbitals.map((orbital) => orbital.energy)).toStrictEqual([
    -41.391, -31.014, -19.265, -17.226, -17.226, -6.668, -6.668, 4.656,
  ]);

  expect(singlet.filledLevels).toBe(6);
  expect(singlet.heatOfFormation).toBe(21.58036);
  expect(singlet.ionizationPotential).toBe(11.52642);
  expect(singlet.orbitals.map((orbital) => orbital.energy)).toStrictEqual([
    -41.391, -31.014, -19.265, -17.657, -16.796, -11.526, -1.81, 4.656,
  ]);
  // The triplet is the ground state, by 27.4 kcal/mol at AM1.
  expect(triplet.heatOfFormation).toBeLessThan(singlet.heatOfFormation);
});

test('spin: doublet runs the half-electron open shell on the methyl radical', async () => {
  const result = await mopac7({ ...EXTRA_MOLECULES.methyl, spin: 'doublet' });

  expect(result.filledLevels).toBe(3);
  expect(result.basis).toHaveLength(7);
  expect(result.pointGroup).toBe('D3H');
  expect(result.heatOfFormation).toBe(31.34282);
  expect(result.ionizationPotential).toBe(9.78506);
  expect(result.totalEnergy).toBe(-167.83423);
  expect(result.orbitals.map((orbital) => orbital.energy)).toStrictEqual([
    -27.216, -13.848, -13.848, -4.245, 4.715, 5.12, 5.121,
  ]);
  // MOPAC 7.00 prints the D3H primes; 7.01 prints the same labels without them.
  expect(result.orbitals[3]?.symmetry).toBe('1A2"');
  expect(Array.from(result.charges)).toStrictEqual([
    -0.3061, 0.1021, 0.102, 0.102,
  ]);
  // A planar radical with three equivalent hydrogens has no dipole.
  expect(result.dipole).toStrictEqual({ x: 0, y: 0, z: 0, total: 0 });

  // Seven electrons leave MOPAC no closed-shell option, so leaving spin at its
  // default runs the same half-electron calculation: the keyword is explicit,
  // not what makes the shell open.
  const implied = await mopac7(EXTRA_MOLECULES.methyl);

  expect(implied.heatOfFormation).toBe(result.heatOfFormation);
  expect(implied.filledLevels).toBe(3);
});
