import { expect, test } from 'vitest';

import { tryNumbers } from '../output/fields.ts';

test('a blank line is not a row of one number', () => {
  // This is the line MOPAC prints between "Root No.    9" and the eigenvalue of
  // that ninth root. Reading it as a zero used to make the parser take the
  // symmetry label line for the coefficients and give up on the whole group.
  expect(tryNumbers('', 1)).toBeNull();
  expect(tryNumbers(' '.repeat(3), 1)).toBeNull();
  expect(tryNumbers('  \t ', 1)).toBeNull();
});

test('a fixed-width row is read at its column positions', () => {
  expect(tryNumbers('  S   O  1   .8975   .0000   .3563', 3)).toStrictEqual([
    0.8975, 0, 0.3563,
  ]);
});

test('an eigenvalue row whose fields run together still reads', () => {
  // F8.3 leaves no separator once a value goes below -100 eV, which is why the
  // fixed-width read comes before the whitespace split.
  expect(tryNumbers(`${' '.repeat(10)}-136.288-118.143`, 2)).toStrictEqual([
    -136.288, -118.143,
  ]);
});

test('a row of the wrong width reads as nothing', () => {
  expect(tryNumbers('           -36.288 -18.143', 3)).toBeNull();
  expect(tryNumbers('                1 A1    1 B2', 2)).toBeNull();
});
