/**
 * What the parser does with a listing that is not a finished run: MOPAC 7 exits
 * 0 at every one of its `STOP` statements, and the >99-atom truncation showed
 * that a listing can also be short without stopping. Neither may come back as a
 * plausible wrong number.
 */
import { expect, test } from 'vitest';

import { parseMopac7Output } from '../output/parseMopac7Output.ts';

import { catchMopac7Error } from './catchMopac7Error.ts';
import { listing } from './listing.ts';

test('a listing that stops before the SCF throws, quoting what MOPAC last printed', () => {
  const truncated = listing('water-am1.out').split(
    'SCF FIELD WAS ACHIEVED',
    1,
  )[0] as string;
  const error = catchMopac7Error(() => parseMopac7Output(truncated));

  expect(error.code).toBe('halt');
  expect(error.message).toContain('its last words were');
  // The last three non-blank lines of the truncated listing, verbatim.
  expect(error.message).toContain('1SCF WAS SPECIFIED, SO BFGS WAS NOT USED');
});

test('an eigenvector block that lost a row throws instead of returning a short basis', () => {
  // The eigenvector matrix is square, so six roots over five basis functions is
  // a listing that was not read to the end -- which is the shape the >99-atom
  // truncation had, where every group stopped at the same row.
  const short = listing('water-am1.out')
    .split('\n')
    .filter((line) => !line.startsWith('  S   H  3'))
    .join('\n');
  const error = catchMopac7Error(() => parseMopac7Output(short));

  expect(error.code).toBe('parse');
  expect(error.message).toBe(
    'MOPAC printed 6 molecular orbitals over a basis of 5 atomic orbitals, ' +
      'and the eigenvector matrix is square, so the listing was not read to the end',
  );
});

test('a basis that does not reach the last atom throws and names the atoms it lost', () => {
  const error = catchMopac7Error(() =>
    parseMopac7Output(
      listing('water-am1.out').replaceAll(
        /^ {2}S {3}H {2}3.*$/gm,
        '  S   H  2  0.0000  0.0000  0.0000  0.0000  0.0000  0.0000',
      ),
    ),
  );

  expect(error.code).toBe('parse');
  expect(error.message).toBe(
    'the eigenvectors reach atom 2 but the charge block lists 3 atoms, ' +
      'so the rows of atoms 3 to 3 were not read',
  );
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

  expect(error.code).toBe('halt');
  expect(error.message).toBe(
    'MOPAC stopped before it converged a wavefunction, and its last words were: ',
  );
});
