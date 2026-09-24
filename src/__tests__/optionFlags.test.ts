/**
 * End-to-end coverage of `optimize`, `allOrbitals`, `precise` and the MINDO/3
 * hamiltonian.
 *
 * Every literal here was produced by running the very deck `buildMopac7Input`
 * writes through TWO native MOPAC 7 binaries — this repository's own native
 * build of the translated C, and the independent Ghemical packaging of MOPAC
 * 7.01 — which agreed on every value below to the last printed decimal. None of
 * it is a recording of the WebAssembly build's own output.
 */
import { expect, test } from 'vitest';

import { mopac7 } from '../mopac7.ts';

import { catchMopac7ErrorAsync } from './catchMopac7Error.ts';
import { EXTRA_MOLECULES, MOLECULES } from './molecules.ts';

test('optimize: true relaxes the geometry and MOPAC says BFGS converged', async () => {
  const result = await mopac7({ ...MOLECULES.water, optimize: true });

  expect(result.terminationMessage).toBe(
    'PETERS TEST WAS SATISFIED IN BFGS OPTIMIZATION',
  );
  expect(result.heatOfFormation).toBe(-59.24072);
  expect(result.ionizationPotential).toBe(12.46391);
  expect(result.totalEnergy).toBe(-348.56254);
  expect(result.electronicEnergy).toBe(-493.2763);
  expect(result.coreCoreRepulsion).toBe(144.71376);
  expect(result.pointGroup).toBe('C2V');
  expect(result.orbitals.map((orbital) => orbital.energy)).toStrictEqual([
    -36.424, -18.203, -14.95, -12.464, 4.417, 6.195,
  ]);
  expect(Array.from(result.charges)).toStrictEqual([-0.3828, 0.1914, 0.1914]);
  expect(result.dipole).toStrictEqual({
    x: 1.151,
    y: 1.462,
    z: 0,
    total: 1.86,
  });
  // The relaxed frame, not the one handed in.
  expect(Array.from(result.coordinates)).toStrictEqual([
    -0.245, -0.3134, 0, 0.7162, -0.3134, 0, -0.4708, 0.6209, 0,
  ]);

  // The single point on the same geometry is higher, and says it never optimised.
  const single = await mopac7(MOLECULES.water);

  expect(single.heatOfFormation).toBe(-59.17072);
  expect(single.terminationMessage).toBe(
    '1SCF WAS SPECIFIED, SO BFGS WAS NOT USED',
  );
  expect(result.heatOfFormation).toBeLessThan(single.heatOfFormation);
});

test('allOrbitals: false keeps every energy and drops the ALLVEC DEBUG dump', async () => {
  const result = await mopac7({ ...MOLECULES.water, allOrbitals: false });

  expect(result.heatOfFormation).toBe(-59.17072);
  expect(result.ionizationPotential).toBe(12.44576);
  expect(Array.from(result.charges)).toStrictEqual([-0.3848, 0.1924, 0.1924]);
  // Water has six orbitals, so MOPAC's window around the HOMO happens to cover
  // the whole spectrum even without ALLVEC.
  expect(result.orbitals).toHaveLength(6);
  expect(result.orbitals.map((orbital) => orbital.energy)).toStrictEqual([
    -36.288, -18.143, -14.906, -12.446, 4.341, 6.145,
  ]);
  expect(result.unknownKeywords).toStrictEqual([]);
});

test('allOrbitals: false on a molecule whose window is partial throws and says why', async () => {
  const error = await catchMopac7ErrorAsync(() =>
    mopac7({ ...MOLECULES.benzene, allOrbitals: false }),
  );

  expect(error.code).toBe('parse');
  expect(error.message).toContain('MOPAC printed root 7 where root 1');
  expect(error.message).toContain(
    'the deck needs the ALLVEC and DEBUG keywords',
  );
});

test('precise: false leaves the SCF looser, in the fifth decimal', async () => {
  const loose = await mopac7({ ...MOLECULES.water, precise: false });
  const tight = await mopac7(MOLECULES.water);

  expect(loose.heatOfFormation).toBe(-59.17071);
  expect(tight.heatOfFormation).toBe(-59.17072);
  expect(loose.ionizationPotential).toBe(12.44564);
  expect(tight.ionizationPotential).toBe(12.44576);
  // Three printed decimals hide the difference entirely.
  expect(loose.orbitals.map((orbital) => orbital.energy)).toStrictEqual(
    tight.orbitals.map((orbital) => orbital.energy),
  );
  expect(Array.from(loose.charges)).toStrictEqual(Array.from(tight.charges));
});

test('MINDO3 is its own hamiltonian, not AM1 under another name', async () => {
  const result = await mopac7({ ...MOLECULES.water, method: 'MINDO3' });

  expect(result.heatOfFormation).toBe(-53.08312);
  expect(result.ionizationPotential).toBe(12.73504);
  expect(result.totalEnergy).toBe(-341.48315);
  expect(result.electronicEnergy).toBe(-479.36278);
  expect(result.coreCoreRepulsion).toBe(137.87962);
  expect(result.pointGroup).toBe('C2V');
  expect(result.orbitals.map((orbital) => orbital.energy)).toStrictEqual([
    -29.268, -17.139, -14.361, -12.735, 3.721, 5.268,
  ]);
  expect(Array.from(result.charges)).toStrictEqual([-0.4989, 0.2494, 0.2494]);
  expect(Array.from(result.electronDensities)).toStrictEqual([
    6.4989, 0.7506, 0.7506,
  ]);
  expect(result.dipole).toStrictEqual({
    x: 1.296,
    y: 1.658,
    z: 0,
    total: 2.104,
  });
  // The 1B1 HOMO, non-degenerate: pure oxygen 2pz, positive by convention.
  expect(Array.from(result.coefficients.slice(3 * 6, 4 * 6))).toStrictEqual([
    0, 0, 0, 1, 0, 0,
  ]);
});

test('MINDO3 on methane keeps the threefold degeneracy of the T2 level', async () => {
  const result = await mopac7({
    ...EXTRA_MOLECULES.methane,
    method: 'MINDO3',
  });

  expect(result.pointGroup).toBe('TD');
  expect(result.heatOfFormation).toBe(-5.95396);
  expect(result.ionizationPotential).toBe(13.34235);
  expect(result.filledLevels).toBe(4);
  expect(result.orbitals.map((orbital) => orbital.energy)).toStrictEqual([
    -27.281, -13.342, -13.342, -13.342, 3.057, 4.104, 4.104, 4.104,
  ]);
  expect(result.orbitals.map((orbital) => orbital.symmetry)).toStrictEqual([
    '1A1',
    '1T2',
    '1T2',
    '1T2',
    '2A1',
    '2T2',
    '2T2',
    '2T2',
  ]);
  expect(Array.from(result.charges)).toStrictEqual([
    0.0318, -0.008, -0.008, -0.008, -0.008,
  ]);
});
