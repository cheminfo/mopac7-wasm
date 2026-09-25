import { expect, test } from 'vitest';

import { catchMopac7Error } from '../../__tests__/catchMopac7Error.ts';
import { mopac7AtomicOrbitals } from '../mopac7AtomicOrbitals.ts';
import { mopac7Basis } from '../mopac7Basis.ts';

/**
 * What the basis builder refuses, and what it says. Every message names the
 * element, the hamiltonian and the reason, because a caller who asked for a
 * chromium drawing needs to know MOPAC has the energies and not the basis — not
 * that something was `undefined`.
 */

test('chromium has energies and coefficients but no drawable basis', () => {
  const error = catchMopac7Error(() => mopac7AtomicOrbitals(['Cr'], 'MNDO'));

  expect(error.code).toBe('input');
  expect(error.message).toBe(
    "MNDO gives Cr 9 atomic orbitals, so it carries a d shell, and MOPAC 7's own STO-6G table (setupg.f) expands only s and p: this element has orbital energies and coefficients but no drawable basis",
  );
});

test('an element the hamiltonian does not carry is named, with the ones it does', () => {
  const error = catchMopac7Error(() => mopac7AtomicOrbitals(['Xe'], 'PM3'));

  expect(error.code).toBe('input');
  expect(error.message).toContain('PM3 has no Slater exponents for Xe');
  expect(error.message).toContain('Be C N O F Mg Al Si P S Cl Zn');
});

test('a d orbital in the listing is refused rather than dropped', () => {
  const error = catchMopac7Error(() =>
    mopac7Basis({
      method: 'MNDO',
      elements: ['Cr'],
      coordinates: [0, 0, 0],
      basis: [{ atomIndex: 0, element: 'Cr', type: 'z2' }],
    }),
  );

  expect(error.code).toBe('input');
  expect(error.message).toContain('"z2" on Cr is not an s or p orbital');
});

test('an atomic orbital on an atom that was not listed is refused', () => {
  const error = catchMopac7Error(() =>
    mopac7Basis({
      method: 'AM1',
      elements: ['O'],
      coordinates: [0, 0, 0],
      basis: [{ atomIndex: 1, element: 'H', type: 'S' }],
    }),
  );

  expect(error.code).toBe('input');
  expect(error.message).toBe(
    'an atomic orbital sits on atom 2, and only 1 elements were given',
  );
});

test('an atomic orbital on a sparkle, or a p orbital on hydrogen, is refused', () => {
  const sparkle = catchMopac7Error(() =>
    mopac7Basis({
      method: 'MNDO',
      elements: ['Na'],
      coordinates: [0, 0, 0],
      basis: [{ atomIndex: 0, element: 'Na', type: 'S' }],
    }),
  );
  const hydrogenP = catchMopac7Error(() =>
    mopac7Basis({
      method: 'MNDO',
      elements: ['H'],
      coordinates: [0, 0, 0],
      basis: [{ atomIndex: 0, element: 'H', type: 'Px' }],
    }),
  );

  expect(sparkle.message).toBe(
    "MNDO gives Na no atomic orbital \u2014 it is one of MOPAC's sparkles \u2014 yet an atomic orbital was listed on it",
  );
  expect(hydrogenP.message).toBe(
    'MNDO gives H no p exponent, yet a p orbital was listed on it',
  );
});

test('the coordinate count is checked against the elements', () => {
  const error = catchMopac7Error(() =>
    mopac7Basis({
      method: 'AM1',
      elements: ['O', 'H'],
      coordinates: [0, 0, 0, 1],
      basis: [],
    }),
  );

  expect(error.code).toBe('input');
  expect(error.message).toBe('2 elements need 6 coordinates, and 4 were given');
});
