import { expect, test } from 'vitest';

import { mopac7 } from '../mopac7.ts';
import { compileMopac7 } from '../wasm/compileMopac7.ts';

import { EXPECTED } from './expected.ts';
import type { MoleculeName } from './molecules.ts';
import { MOLECULES } from './molecules.ts';

const NAMES: MoleculeName[] = ['water', 'benzene', 'pyridine'];
const METHODS: Array<'AM1' | 'PM3' | 'MNDO'> = ['AM1', 'PM3', 'MNDO'];
const CASES: Array<{ name: MoleculeName; method: 'AM1' | 'PM3' | 'MNDO' }> = [];
for (const name of NAMES) {
  for (const method of METHODS) CASES.push({ name, method });
}

test.each(CASES)(
  '$name $method reproduces the reference run',
  async ({ name, method }) => {
    const expected = EXPECTED[name][method];
    const result = await mopac7({ ...MOLECULES[name], method });

    expect(result.version).toBe('7.00');
    expect(result.method).toBe(method);
    expect(result.converged).toBe(true);
    expect(result.terminationMessage).toBe(
      '1SCF WAS SPECIFIED, SO BFGS WAS NOT USED',
    );
    expect(result.heatOfFormation).toBe(expected.heatOfFormation);
    expect(result.ionizationPotential).toBe(expected.ionizationPotential);
    expect(result.pointGroup).toBe(expected.pointGroup);
    expect(result.filledLevels).toBe(expected.filledLevels);
    expect(result.basis).toHaveLength(expected.basisSize);
    expect(result.orbitals).toHaveLength(expected.basisSize);
    expect(result.coefficients).toHaveLength(
      expected.basisSize * expected.basisSize,
    );

    const occupied = result.orbitals.slice(0, expected.filledLevels);

    expect(occupied.map((orbital) => orbital.energy)).toStrictEqual(
      expected.occupiedEnergies,
    );
    expect(occupied.map((orbital) => orbital.symmetry)).toStrictEqual(
      expected.symmetryLabels,
    );
    expect(occupied.map((orbital) => orbital.occupancy)).toStrictEqual(
      Array.from({ length: expected.filledLevels }, () => 2),
    );
    // Koopmans: the printed ionisation potential is the negated HOMO energy, but
    // MOPAC prints it to five decimals and the eigenvalues to three.
    expect(occupied.at(-1)?.energy).toBe(
      Math.round(-expected.ionizationPotential * 1000) / 1000,
    );
  },
);

test('water AM1 returns the whole wavefunction, not just the energies', async () => {
  const result = await mopac7({ ...MOLECULES.water, method: 'AM1' });

  expect(result.elements).toStrictEqual(['O', 'H', 'H']);
  expect(result.totalEnergy).toBe(-348.55951);
  expect(result.electronicEnergy).toBe(-492.45267);
  expect(result.coreCoreRepulsion).toBe(143.89317);
  expect(result.molecularWeight).toBe(18.015);
  expect(result.unknownKeywords).toStrictEqual([]);
  expect(result.basis).toStrictEqual([
    { atomIndex: 0, element: 'O', type: 'S' },
    { atomIndex: 0, element: 'O', type: 'Px' },
    { atomIndex: 0, element: 'O', type: 'Py' },
    { atomIndex: 0, element: 'O', type: 'Pz' },
    { atomIndex: 1, element: 'H', type: 'S' },
    { atomIndex: 2, element: 'H', type: 'S' },
  ]);
  // Every literal below is the printed value of an independent MOPAC 7.01 run
  // of the same deck (the Ghemical packaging, at
  // out/energy-eval/mopac/runs7/MOPAC7-AM1/water), not of this build's own
  // listing. The coefficients are that run's, through the phase convention.
  expect(Array.from(result.coefficients.slice(0, 6))).toStrictEqual([
    0.8975, 0.0933, 0.1194, 0, 0.2928, 0.2928,
  ]);
  // The 1B1 HOMO is the out-of-plane oxygen lone pair: pure O 2pz, and MOPAC
  // puts the molecule in the xy plane, so the column is zero but for Pz. The
  // sign is the phase convention's, not the listing's, which prints -1.
  expect(Array.from(result.coefficients.slice(3 * 6, 4 * 6))).toStrictEqual([
    0, 0, 0, 1, 0, 0,
  ]);
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

test('a dummy atom is inserted for a linear molecule and never reaches the result', async () => {
  // getgeo.f stops on three collinear leading atoms, so the deck carries an XX
  // row; MOPAC drops it again from every printed block.
  const result = await mopac7({
    elements: ['H', 'C', 'C', 'H'],
    coordinates: [
      [0, 0, -1.6644],
      [0, 0, -0.6013],
      [0, 0, 0.6013],
      [0, 0, 1.6644],
    ],
    method: 'AM1',
  });

  expect(result.elements).toStrictEqual(['H', 'C', 'C', 'H']);
  expect(result.charges).toHaveLength(4);
  expect(result.basis).toHaveLength(10);
  expect(result.pointGroup).toBe('D*H');
  // verification/reference-mopac7.json, methods.AM1.ethyne.
  expect(result.heatOfFormation).toBe(54.87725);
  expect(result.filledLevels).toBe(5);
  expect(
    result.orbitals.slice(0, 5).map((orbital) => orbital.energy),
  ).toStrictEqual([-32.895, -20.634, -15.444, -11.439, -11.439]);
  expect(
    result.orbitals.slice(0, 5).map((orbital) => orbital.symmetry),
  ).toStrictEqual(['1SIG', '1SIU', '2SIG', '1PIU', '1PIU']);
});

test('the very same WebAssembly.Module object is handed out after a calculation', async () => {
  const before = await compileMopac7();

  await mopac7({ ...MOLECULES.water, method: 'PM3' });
  const after = await compileMopac7();

  // Identity, not equality: a module recompiled per call would be a new object
  // every time, and structured-cloning it to a worker would then be pointless.
  expect(after).toBe(before);
  expect(before).toBeInstanceOf(WebAssembly.Module);
});

test('every calculation gets a fresh instance, so an interleaved run leaves nothing behind', async () => {
  // MOPAC 7 keeps its whole state in SAVEd Fortran COMMON, so a reused instance
  // would carry the middle run's converged density and keyword flags into the
  // third one and its numbers would drift off the reference.
  const first = await mopac7({ ...MOLECULES.water, method: 'PM3' });

  await mopac7({ ...MOLECULES.benzene, method: 'MNDO' });
  const again = await mopac7({ ...MOLECULES.water, method: 'PM3' });

  expect(again.heatOfFormation).toBe(EXPECTED.water.PM3.heatOfFormation);
  expect(again.heatOfFormation).toBe(first.heatOfFormation);
  expect(again.ionizationPotential).toBe(first.ionizationPotential);
  expect(Array.from(again.coefficients)).toStrictEqual(
    Array.from(first.coefficients),
  );
});
