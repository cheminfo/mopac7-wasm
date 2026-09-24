/**
 * A MOPAC deck is positional, so an extra keyword is never inert text: see
 * `src/input/keywords.ts` for what each refusal below protects.
 */
import { expect, test } from 'vitest';

import { buildMopac7Input } from '../input/buildMopac7Input.ts';

import { catchMopac7Error } from './catchMopac7Error.ts';
import { MOLECULES } from './molecules.ts';

test('a keyword holding a newline is refused instead of shifting the deck', () => {
  const error = catchMopac7Error(() =>
    buildMopac7Input({ ...MOLECULES.water, keywords: ['FOO\nBAR'] }),
  );

  expect(error.code).toBe('input');
  expect(error.message).toBe(
    `${String.raw`the keyword "FOO\nBAR" holds whitespace or a character MOPAC cannot read; `}pass one keyword per array entry, using only printable ASCII`,
  );
});

test.each([
  { keyword: 'MULLIK BONDS', why: 'a space would start a second keyword' },
  { keyword: '\tMULLIK', why: 'a tab is whitespace too' },
  { keyword: 'MULLIK\r', why: 'a carriage return ends the line' },
  { keyword: 'MÜLLIK', why: 'MOPAC upper-cases ASCII and nothing else' },
])('the keyword $keyword is refused: $why', ({ keyword }) => {
  const error = catchMopac7Error(() =>
    buildMopac7Input({ ...MOLECULES.water, keywords: [keyword] }),
  );

  expect(error.code).toBe('input');
  expect(error.message).toContain(
    'whitespace or a character MOPAC cannot read',
  );
});

test('an empty keyword is refused', () => {
  const error = catchMopac7Error(() =>
    buildMopac7Input({ ...MOLECULES.water, keywords: [''] }),
  );

  expect(error.code).toBe('input');
  expect(error.message).toBe('a keyword in options.keywords is empty');
});

test('a keyword holding + is refused, because it makes MOPAC read the title as keywords', () => {
  const error = catchMopac7Error(() =>
    buildMopac7Input({ ...MOLECULES.water, keywords: ['+'] }),
  );

  expect(error.code).toBe('input');
  expect(error.message).toContain(
    "which is MOPAC's marker for a second keyword line",
  );
});

test('SETUP is refused, because it makes MOPAC read keywords from a file', () => {
  const error = catchMopac7Error(() =>
    buildMopac7Input({ ...MOLECULES.water, keywords: ['SETUP=other.txt'] }),
  );

  expect(error.code).toBe('input');
  expect(error.message).toContain('makes MOPAC read keywords from a file');
});

test('UHF is refused, and the message points at the spin option', () => {
  const error = catchMopac7Error(() =>
    buildMopac7Input({
      ...MOLECULES.water,
      spin: 'triplet',
      keywords: ['UHF'],
    }),
  );

  expect(error.code).toBe('input');
  expect(error.message).toBe(
    'UHF is not supported: its listing carries separate alpha and beta eigenvectors, which this result type ' +
      "has no shape for. Use the spin option on its own for MOPAC's RHF half-electron open-shell treatment",
  );
  // Lower case is the same keyword to MOPAC, which upper-cases the line.
  expect(
    catchMopac7Error(() =>
      buildMopac7Input({ ...MOLECULES.water, keywords: ['uhf'] }),
    ).code,
  ).toBe('input');
  // The multiplicity on its own is fine.
  expect(
    buildMopac7Input({ ...MOLECULES.water, spin: 'triplet' }).split('\n', 1)[0],
  ).toBe('AM1 1SCF XYZ VECTORS ALLVEC PRECISE GEO-OK CHARGE=0 TRIPLET MMOK');
});

test.each(['MMOK', 'NOMM', 'nomm'])(
  '%s in options.keywords is refused, and the message points at amideCorrection',
  (keyword) => {
    const error = catchMopac7Error(() =>
      buildMopac7Input({ ...MOLECULES.water, keywords: [keyword] }),
    );

    expect(error.code).toBe('input');
    expect(error.message).toContain(
      'is set through the amideCorrection option',
    );
  },
);

test('the amide keyword is on every deck, and amideCorrection picks which', () => {
  // moldat.f stops on any -HNCO- group when the deck names neither, so there is
  // no third state: water carries one too.
  expect(buildMopac7Input(MOLECULES.water).split('\n', 1)[0]).toContain(
    ' MMOK',
  );
  expect(
    buildMopac7Input({ ...MOLECULES.water, amideCorrection: 'nomm' }).split(
      '\n',
      1,
    )[0],
  ).toBe('AM1 1SCF XYZ VECTORS ALLVEC PRECISE GEO-OK CHARGE=0 NOMM');
});

test('a coordinate count that does not match the elements is refused', () => {
  const error = catchMopac7Error(() =>
    buildMopac7Input({
      elements: ['O', 'H', 'H'],
      coordinates: [0, 0, 0, 1, 0, 0],
    }),
  );

  expect(error.code).toBe('input');
  expect(error.message).toBe('there are 3 elements but 2 sets of coordinates');
});
