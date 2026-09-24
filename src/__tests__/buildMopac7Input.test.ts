import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { buildMopac7Input } from '../input/buildMopac7Input.ts';

import { catchMopac7Error } from './catchMopac7Error.ts';
import { MOLECULES } from './molecules.ts';

/**
 * The decks under `verification/` are what produced
 * `verification/reference-mopac7.json`, so reproducing their geometry blocks
 * exactly is what makes those reference numbers apply to this package's output.
 * @param method - `AM1`, `PM3` or `MNDO`.
 * @param name - The molecule's deck name.
 * @returns The deck, verbatim.
 */
function referenceDeck(method: string, name: string): string {
  return readFileSync(
    join(
      import.meta.dirname,
      '..',
      '..',
      'verification',
      'decks',
      method,
      `${name}.dat`,
    ),
    'utf8',
  );
}

/**
 * Everything below the keyword line, the title and the blank third line.
 * @param deck - A MOPAC deck.
 * @returns Its geometry block.
 */
function geometryOf(deck: string): string {
  return deck.split('\n').slice(3).join('\n').trimEnd();
}

test('water is written as a Z-matrix, because MOPAC reads three atoms that way whatever XYZ says', () => {
  const deck = buildMopac7Input({ ...MOLECULES.water, method: 'AM1' });

  expect(deck).toBe(
    [
      'AM1 1SCF XYZ VECTORS ALLVEC DEBUG PRECISE GEO-OK CHARGE=0',
      'mopac7-wasm',
      ' ',
      ' O      0.00000000 0     0.00000000 0     0.00000000 0   0   0   0',
      ' H      0.96899941 0     0.00000000 0     0.00000000 0   1   0   0',
      ' H      0.96899941 0   103.97772913 0     0.00000000 0   1   2   0',
      '',
    ].join('\n'),
  );
  expect(geometryOf(deck)).toBe(geometryOf(referenceDeck('AM1', 'water')));
});

test('benzene reproduces the verification deck exactly', () => {
  const deck = buildMopac7Input({ ...MOLECULES.benzene, method: 'PM3' });

  expect(geometryOf(deck)).toBe(geometryOf(referenceDeck('PM3', 'benzene')));
});

test('pyridine reproduces the verification deck exactly', () => {
  const deck = buildMopac7Input({ ...MOLECULES.pyridine, method: 'MNDO' });

  expect(geometryOf(deck)).toBe(geometryOf(referenceDeck('MNDO', 'pyridine')));
});

test('a linear molecule gets a dummy XX row as its third atom', () => {
  const deck = buildMopac7Input({
    elements: ['H', 'C', 'C', 'H'],
    coordinates: [
      [0, 0, -1.6644],
      [0, 0, -0.6013],
      [0, 0, 0.6013],
      [0, 0, 1.6644],
    ],
    method: 'AM1',
  });
  const rows = deck.split('\n').slice(3, 8);

  expect(rows).toHaveLength(5);
  expect(rows[2]).toBe(
    ' XX     1.00000000 0     0.00000000 0    -0.60130000 0   0   0   0',
  );
  expect(geometryOf(deck)).toBe(geometryOf(referenceDeck('AM1', 'ethyne')));
});

test('the keyword line follows the options', () => {
  const water = MOLECULES.water;

  expect(buildMopac7Input({ ...water, method: 'MNDO' }).split('\n', 1)[0]).toBe(
    'MNDO 1SCF XYZ VECTORS ALLVEC DEBUG PRECISE GEO-OK CHARGE=0',
  );
  expect(
    buildMopac7Input({
      ...water,
      method: 'MINDO3',
      allOrbitals: false,
      precise: false,
      optimize: true,
      charge: -1,
      spin: 'doublet',
    }).split('\n', 1)[0],
  ).toBe('MINDO3 XYZ VECTORS GEO-OK CHARGE=-1 DOUBLET');
  expect(
    buildMopac7Input({ ...water, keywords: ['MULLIK', 'BONDS'] }).split(
      '\n',
      1,
    )[0],
  ).toBe(
    'AM1 1SCF XYZ VECTORS ALLVEC DEBUG PRECISE GEO-OK CHARGE=0 MULLIK BONDS',
  );
  expect(
    buildMopac7Input({ ...water, title: 'my run' }).split('\n', 2)[1],
  ).toBe('my run');
});

test('a flat coordinate array and a Float64Array give the same deck as nested rows', () => {
  const water = MOLECULES.water;
  const nested = buildMopac7Input(water);
  const flat = water.coordinates.flat();

  expect(
    buildMopac7Input({ elements: water.elements, coordinates: flat }),
  ).toBe(nested);
  expect(
    buildMopac7Input({
      elements: water.elements,
      coordinates: Float64Array.from(flat),
    }),
  ).toBe(nested);
});

test('a symbol MOPAC does not know is refused before the module is touched', () => {
  const error = catchMopac7Error(() =>
    buildMopac7Input({
      elements: ['Xq', 'H'],
      coordinates: [
        [0, 0, 0],
        [1, 0, 0],
      ],
    }),
  );

  expect(error.code).toBe('input');
  expect(error.message).toBe('"Xq" is not an element symbol MOPAC 7 knows');
});

test('an element the hamiltonian has no parameters for names the ones it does have', () => {
  const lithiumHydride = {
    elements: ['Li', 'H'],
    coordinates: [
      [0, 0, 0],
      [1.6, 0, 0],
    ],
  };
  const error = catchMopac7Error(() =>
    buildMopac7Input({ ...lithiumHydride, method: 'PM3' }),
  );

  expect(error.code).toBe('input');
  expect(error.message).toContain('MOPAC 7 has no PM3 parameters for Li');
  expect(error.message).toContain('H, Be, C, N, O, F');
  // The same molecule is fine under AM1, which does carry lithium.
  expect(
    buildMopac7Input({ ...lithiumHydride, method: 'AM1' }).split('\n', 1)[0],
  ).toBe('AM1 1SCF XYZ VECTORS ALLVEC DEBUG PRECISE GEO-OK CHARGE=0');
});

test('a molecule past the compiled array bounds is refused with the bound in the message', () => {
  const elements: string[] = [];
  const coordinates: number[][] = [];
  for (let index = 0; index < 31; index++) {
    elements.push('C');
    coordinates.push([index * 1.5, 0.1 * index, 0]);
  }
  const error = catchMopac7Error(() =>
    buildMopac7Input({ elements, coordinates }),
  );

  expect(error.code).toBe('input');
  expect(error.message).toBe(
    '31 non-hydrogen atoms, and this build of MOPAC 7 holds at most 30',
  );
});
