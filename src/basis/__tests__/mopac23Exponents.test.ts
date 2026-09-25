import { expect, test } from 'vitest';

import { MOPAC7_ELEMENTS } from '../../input/elements.ts';
import { MOPAC7_SLATER_EXPONENTS } from '../slaterExponents.ts';

import { MOPAC23_EXPONENTS, MOPAC23_OVERLAPS } from './mopac23Fixtures.ts';

/**
 * The six exponents OpenMOPAC re-fitted after 1993, with the value MOPAC 23 now
 * carries and the line it carries it on. They are the only place the two programs
 * disagree, and mopac7-wasm must keep MOPAC 7's own number: the coefficients it is
 * asked to draw were computed with it.
 */
const REPARAMETERISED: Record<
  string,
  { mopac7: number; mopac23: number; source: string }
> = {
  'MNDO Li s': {
    mopac7: 0.70238,
    mopac23: 0.4296141,
    source: 'parameters_for_mndo_C.F90 line 55',
  },
  'MNDO Li p': {
    mopac7: 0.70238,
    mopac23: 0.7554884,
    source: 'parameters_for_mndo_C.F90 line 56',
  },
  'AM1 Li s': {
    mopac7: 0.70238,
    mopac23: 0.7973487,
    source: 'parameters_for_AM1_C.F90 line 64',
  },
  'AM1 Li p': {
    mopac7: 0.70238,
    mopac23: 0.9045583,
    source: 'parameters_for_AM1_C.F90 line 65',
  },
  'AM1 Be s': {
    mopac7: 1.00421,
    mopac23: 0.7425237,
    source: 'parameters_for_AM1_C.F90 line 79',
  },
  'AM1 Be p': {
    mopac7: 1.00421,
    mopac23: 0.8080499,
    source: 'parameters_for_AM1_C.F90 line 80',
  },
};

test('the fixture is OpenMOPAC 23.2.5 over every element it and MOPAC 7 share', () => {
  expect(MOPAC23_EXPONENTS.provenance.program).toBe('OpenMOPAC 23.2.5');
  expect(MOPAC23_EXPONENTS.rows).toHaveLength(94);
  expect(MOPAC23_OVERLAPS.jobs).toHaveLength(12);
});

test('every exponent and principal quantum number matches OpenMOPAC 23', () => {
  // Both sides are built as `"<hamiltonian> <element> <shell> <value>"` lines and
  // compared once, so one failure names exactly which shell of which element of
  // which hamiltonian moved, and a line that goes missing is a failure too.
  const ours: string[] = [];
  const theirs: string[] = [];
  const compared: string[] = [];
  const differing: string[] = [];
  const noShell: string[] = [];
  const sparkles: string[] = [];
  const unsupported: string[] = [];

  for (const row of MOPAC23_EXPONENTS.rows) {
    const key = `${row.method} ${row.element}`;
    if (!MOPAC7_ELEMENTS[row.method].includes(row.element)) {
      unsupported.push(key);
      continue;
    }
    const entry = MOPAC7_SLATER_EXPONENTS[row.method][row.element];
    if (entry === undefined) {
      sparkles.push(key);
      continue;
    }
    ours.push(`${key} n ${entry.principalQuantumNumber}`);
    theirs.push(`${key} n ${row.principalQuantumNumber}`);
    for (const [shell, mine, printed] of [
      ['s', entry.zetaS, row.zetaS],
      ['p', entry.zetaP, row.zetaP],
    ] as const) {
      const label = `${key} ${shell}`;
      const known = REPARAMETERISED[label];
      if (known === undefined) {
        ours.push(`${label} ${mine}`);
        theirs.push(`${label} ${printed}`);
        if (printed === null) noShell.push(label);
        else compared.push(label);
        continue;
      }
      // A known re-fit is pinned on both sides at once, so neither value can
      // drift without the comparison failing.
      ours.push(`${label} ${mine} vs ${printed}`);
      theirs.push(`${label} ${known.mopac7} vs ${known.mopac23}`);
      differing.push(label);
    }
  }

  expect(ours).toStrictEqual(theirs);
  // 123 exponents over 66 element-and-hamiltonian pairs agree to the last printed
  // digit, three hydrogens have no p shell, and six are the known re-fits.
  expect(compared).toHaveLength(123);
  expect(noShell.toSorted()).toStrictEqual(['AM1 H p', 'MNDO H p', 'PM3 H p']);
  expect(differing.toSorted()).toStrictEqual(
    Object.keys(REPARAMETERISED).toSorted(),
  );
  // Na and K carry real 3s/3p and 4s/4p sets in MOPAC 23 and are sparkles in
  // MOPAC 7. `mopac7Basis.test.ts` checks those against MOPAC 7 itself instead.
  expect(sparkles.toSorted()).toStrictEqual([
    'AM1 K',
    'AM1 Na',
    'MNDO K',
    'MNDO Na',
    'PM3 K',
    'PM3 Na',
  ]);
  // The rest are elements MOPAC 23 added to a hamiltonian after 1993.
  expect(unsupported).toHaveLength(22);
});

test('MOPAC 23 covers every element in the tables but eleven, and says why', () => {
  const rows = new Set(
    MOPAC23_EXPONENTS.rows.map((row) => `${row.method} ${row.element}`),
  );
  const uncovered: string[] = [];
  let pairs = 0;
  for (const [method, table] of Object.entries(MOPAC7_SLATER_EXPONENTS)) {
    for (const element of Object.keys(table)) {
      pairs++;
      if (!rows.has(`${method} ${element}`)) {
        uncovered.push(`${method} ${element}`);
      }
    }
  }

  expect(pairs).toBe(77);
  // MOPAC 23 dropped MINDO/3 and has no MNDO chromium, so these eleven have no
  // external reference and rest on `block.f` alone.
  expect(uncovered).toStrictEqual([
    'MNDO Cr',
    'MINDO3 H',
    'MINDO3 B',
    'MINDO3 C',
    'MINDO3 N',
    'MINDO3 O',
    'MINDO3 F',
    'MINDO3 Si',
    'MINDO3 P',
    'MINDO3 S',
    'MINDO3 Cl',
  ]);
});
