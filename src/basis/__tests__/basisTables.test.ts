import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { MOPAC7_ELEMENTS, elementNumber } from '../../input/elements.ts';
import type { Mopac7Method } from '../../types.ts';
import { MOPAC7_SLATER_EXPONENTS } from '../slaterExponents.ts';
import { MOPAC7_STO6G } from '../sto6g.ts';

import { parseBasisFortran } from './parseBasisFortran.ts';

/**
 * `src/basis/slaterExponents.ts` and `src/basis/sto6g.ts` are generated, so they
 * are checked against a fresh parse of the Fortran they came from rather than
 * trusted. `data/mopac7-basis-source.f` is the archive's own lines, verbatim,
 * with the file and line range of each block in its header, and
 * `scripts/generate-basis-tables.mjs` refuses to write either table unless the
 * excerpt reproduces the whole archive.
 */
const FORTRAN = parseBasisFortran(
  readFileSync(
    join(import.meta.dirname, 'data', 'mopac7-basis-source.f'),
    'utf8',
  ),
);
const METHODS: Mopac7Method[] = ['MNDO', 'MINDO3', 'AM1', 'PM3'];

test('the excerpt is the archive the WebAssembly was built from', () => {
  const header = readFileSync(
    join(import.meta.dirname, 'data', 'mopac7-basis-source.f'),
    'utf8',
  ).slice(0, 1000);
  const build: { source: { commit: string; treeSha256: string } } = JSON.parse(
    readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'wasm', 'BUILD.json'),
      'utf8',
    ),
  );

  expect(header).toContain(build.source.commit);
  expect(header).toContain(build.source.treeSha256);
});

test.each(METHODS)(
  '%s exponents are exactly what block.f and diat.f say',
  (method) => {
    const table = MOPAC7_SLATER_EXPONENTS[method];
    const fortran = FORTRAN.exponents[method];
    let checked = 0;

    // One object per element on each side, so a mismatch names the element.
    const ours: Record<string, unknown> = {};
    const theirs: Record<string, unknown> = {};
    for (const [symbol, entry] of Object.entries(table)) {
      const atomicNumber = elementNumber(symbol) as number;
      ours[symbol] = entry;
      theirs[symbol] = {
        atomicNumber,
        principalQuantumNumber:
          FORTRAN.principalQuantumNumber[atomicNumber - 1],
        orbitalCount: FORTRAN.orbitalCount[atomicNumber - 1],
        zetaS: fortran.get(atomicNumber)?.s,
        zetaP: fortran.get(atomicNumber)?.p,
      };
      checked++;
    }

    expect(ours).toStrictEqual(theirs);

    expect(checked).toBe(
      MOPAC7_ELEMENTS[method].filter((symbol) => {
        const atomicNumber = elementNumber(symbol) as number;
        return FORTRAN.orbitalCount[atomicNumber - 1] !== 0;
      }).length,
    );
  },
);

test('the two sparkles are the only supported elements with no basis', () => {
  const missing: string[] = [];
  for (const method of METHODS) {
    for (const symbol of MOPAC7_ELEMENTS[method]) {
      if (MOPAC7_SLATER_EXPONENTS[method][symbol] === undefined) {
        missing.push(`${method} ${symbol}`);
      }
    }
  }

  expect(missing).toStrictEqual([
    'MNDO Na',
    'MNDO K',
    'AM1 Na',
    'AM1 K',
    'PM3 Na',
    'PM3 K',
  ]);
  // `block.f` line 89 gives atomic numbers 11 and 19 `NATORB = 0`, and no
  // `DATA ZSM/ZSAM1/ZSPM3` statement mentions either.
  expect(FORTRAN.orbitalCount[10]).toBe(0);
  expect(FORTRAN.orbitalCount[18]).toBe(0);
  expect(FORTRAN.exponents.MNDO.get(11)).toBeUndefined();
  expect(FORTRAN.exponents.MNDO.get(19)).toBeUndefined();
});

test('chromium is the one element MOPAC gives a d shell', () => {
  const withD: string[] = [];
  const wrongCount: string[] = [];
  for (const method of METHODS) {
    for (const [symbol, entry] of Object.entries(
      MOPAC7_SLATER_EXPONENTS[method],
    )) {
      if (entry.orbitalCount === 9) {
        withD.push(`${method} ${symbol}`);
      } else if (entry.orbitalCount !== (symbol === 'H' ? 1 : 4)) {
        wrongCount.push(`${method} ${symbol} ${entry.orbitalCount}`);
      }
    }
  }

  expect(withD).toStrictEqual(['MNDO Cr']);
  // Hydrogen is 1s alone; every other element is s + p.
  expect(wrongCount).toStrictEqual([]);
});

test('the STO-6G table is exactly what setupg.f says', () => {
  expect(MOPAC7_STO6G).toHaveLength(6);

  // One object per table cell on each side, keyed `n=<n> l=<l>`, so a mismatch
  // names the row it is in and a missing cell cannot pass as a null one.
  const ours: Record<string, unknown> = {};
  const theirs: Record<string, unknown> = {};
  const widths: string[] = [];
  for (let n = 1; n <= 6; n++) {
    const row = MOPAC7_STO6G[n - 1] as (typeof MOPAC7_STO6G)[number];
    for (const l of [0, 1]) {
      const fortran = FORTRAN.sto6g[n - 1]?.[l] ?? null;
      const key = `n=${n} l=${l}`;
      ours[key] = row[l] ?? null;
      theirs[key] =
        fortran === null
          ? null
          : { alpha: fortran.alpha, coefficient: fortran.coefficient };
      if (fortran !== null) {
        widths.push(
          `${key} ${fortran.alpha.length} ${fortran.coefficient.length}`,
        );
      }
    }
  }

  expect(ours).toStrictEqual(theirs);
  // Eleven cells, every one of them six primitives wide; only 1p is absent.
  expect(widths).toStrictEqual([
    'n=1 l=0 6 6',
    'n=2 l=0 6 6',
    'n=2 l=1 6 6',
    'n=3 l=0 6 6',
    'n=3 l=1 6 6',
    'n=4 l=0 6 6',
    'n=4 l=1 6 6',
    'n=5 l=0 6 6',
    'n=5 l=1 6 6',
    'n=6 l=0 6 6',
    'n=6 l=1 6 6',
  ]);
  // The 1p shell is the one absent cell, because there is no such orbital.
  expect(MOPAC7_STO6G[0]?.[1]).toBeNull();
  expect(MOPAC7_STO6G[0]?.[0]?.alpha[0]).toBe(23.10303149);
});

test('the exponents of the five elements a hydrocarbon or a heteroaromatic needs', () => {
  // Spot values, so a silently empty parse cannot pass the comparisons above.
  expect(MOPAC7_SLATER_EXPONENTS.MNDO.C).toStrictEqual({
    atomicNumber: 6,
    principalQuantumNumber: 2,
    orbitalCount: 4,
    zetaS: 1.787537,
    zetaP: 1.787537,
  });
  expect(MOPAC7_SLATER_EXPONENTS.MNDO.O?.zetaS).toBe(2.699905);
  expect(MOPAC7_SLATER_EXPONENTS.MNDO.H?.zetaS).toBe(1.331967);
  expect(MOPAC7_SLATER_EXPONENTS.MNDO.H?.zetaP).toBeNull();
  expect(MOPAC7_SLATER_EXPONENTS.AM1.C?.zetaS).toBe(1.808665);
  expect(MOPAC7_SLATER_EXPONENTS.AM1.C?.zetaP).toBe(1.685116);
  expect(MOPAC7_SLATER_EXPONENTS.PM3.O?.zetaS).toBe(3.796544);
  // MINDO/3 is the one hamiltonian whose exponents come from a paired DATA
  // statement (`DATA ZS3(6),ZP3(6)/1.739391D0,1.709645D0/`, block.f line 456).
  expect(MOPAC7_SLATER_EXPONENTS.MINDO3.C).toStrictEqual({
    atomicNumber: 6,
    principalQuantumNumber: 2,
    orbitalCount: 4,
    zetaS: 1.739391,
    zetaP: 1.709645,
  });
  // And whose hydrogen `ZP3(1)` is a literal zero, which is not a p shell.
  expect(MOPAC7_SLATER_EXPONENTS.MINDO3.H?.zetaS).toBe(1.3);
  expect(MOPAC7_SLATER_EXPONENTS.MINDO3.H?.zetaP).toBeNull();
});
