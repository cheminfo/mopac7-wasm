/**
 * Paclitaxel end to end: the molecule `SIZES` was raised for, and the molecule
 * that shows what a coefficient row looks like past atom 99.
 *
 * `matou1.f` right-justifies the atom number in an `I3` field with no separator
 * after the element symbol, so atom 100 prints as `  S   H100` where atom 1
 * prints as `  S   C  1`. Reading that by splitting on whitespace stops at the
 * first three-digit atom — and because every root group stops at the same row,
 * the columns stay the same length and nothing downstream notices. Taxol is
 * 113 atoms, so this is the shape that was returning 285 of 299 basis functions
 * with no complaint at all.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { MOPAC7_LIMITS } from '../limits.ts';
import { mopac7 } from '../mopac7.ts';

/** PubChem CID 36314 through lcao's OpenChemLib conformer + MMFF94 at seed 42. */
const PACLITAXEL = JSON.parse(
  readFileSync(join(import.meta.dirname, 'data', 'paclitaxel.json'), 'utf8'),
) as { elements: string[]; coordinates: number[][] };

test('paclitaxel: 113 atoms and a full 299 x 299 eigenvector matrix', async () => {
  const result = await mopac7({ ...PACLITAXEL, method: 'AM1' });

  expect(result.converged).toBe(true);
  expect(result.elements).toHaveLength(113);
  expect(result.orbitals).toHaveLength(299);
  expect(result.basis).toHaveLength(299);
  expect(result.coefficients).toHaveLength(299 * 299);
  expect(result.charges).toHaveLength(113);
  expect(result.filledLevels).toBe(164);

  // 62 heavy atoms at four orbitals each, then one per hydrogen, so basis
  // function 286 is atom 100's -- the first row of the `I3` field with no space
  // in front of it, and the exact row the whitespace-separated read stopped at.
  expect(result.basis[248]).toStrictEqual({
    atomIndex: 62,
    element: 'H',
    type: 'S',
  });
  expect(result.basis[285]).toStrictEqual({
    atomIndex: 99,
    element: 'H',
    type: 'S',
  });
  expect(result.basis.at(-1)).toStrictEqual({
    atomIndex: 112,
    element: 'H',
    type: 'S',
  });

  // AM1 taxol, which an independent OpenMOPAC 23 run puts at an ionisation
  // potential of 9.5176 eV against this build's 9.51729.
  expect(result.heatOfFormation).toBe(-354.84122);
  expect(result.ionizationPotential).toBe(9.51729);
  expect(result.orbitals[163]?.energy).toBe(-9.517);
});

test('paclitaxel fits this build with the headroom SIZES was chosen for', () => {
  let heavy = 0;
  for (const element of PACLITAXEL.elements) {
    if (element !== 'H') heavy++;
  }
  const hydrogens = PACLITAXEL.elements.length - heavy;

  expect(heavy).toBe(62);
  expect(hydrogens).toBe(51);
  expect(MOPAC7_LIMITS.maxHeavyAtoms - heavy).toBe(2);
  expect(MOPAC7_LIMITS.maxHydrogenAtoms - hydrogens).toBe(5);
  expect(4 * heavy + hydrogens).toBe(299);
});
