import { expect, test } from 'vitest';

import { buildMopac7Input } from '../input/buildMopac7Input.ts';
import { mopac7 } from '../mopac7.ts';
import { parseMopac7Output } from '../output/parseMopac7Output.ts';
import { runMopac7Job } from '../wasm/runMopac7Job.ts';

import { catchMopac7Error, catchMopac7ErrorAsync } from './catchMopac7Error.ts';
import { EXTRA_MOLECULES, MOLECULES } from './molecules.ts';

const WATER_GEOMETRY = [
  ' O      0.00000000 0     0.00000000 0     0.00000000 0   0   0   0',
  ' H      0.96899941 0     0.00000000 0     0.00000000 0   1   0   0',
  ' H      0.96899941 0   103.97772913 0     0.00000000 0   1   2   0',
];

/**
 * These decks go in through `runMopac7Job` rather than `mopac7`, because the
 * wrapper refuses most bad input before MOPAC is started. What is under test
 * here is the other half: that MOPAC's own complaints are recognised and turned
 * into a code, rather than parsed into a plausible wrong number.
 * @param keywords - The first line of the deck.
 * @param geometry - The geometry rows.
 * @returns The deck.
 */
function deck(
  keywords: string,
  geometry: readonly string[] = WATER_GEOMETRY,
): string {
  return `${[keywords, 'mopac7-wasm error test', ' ', ...geometry].join('\n')}\n`;
}

test('an element with no parameters for the method is reported by MOPAC itself', async () => {
  // Lithium has no PM3 parameters: refer.f prints "DATA ARE NOT AVAILABLE FOR
  // ELEMENT NO." and stops.
  const job = await runMopac7Job(
    deck('PM3 1SCF XYZ VECTORS GEO-OK CHARGE=0', [
      ' Li     0.00000000 0     0.00000000 0     0.00000000 0   0   0   0',
      ' H      1.59500000 0     0.00000000 0     0.00000000 0   1   0   0',
    ]),
  );

  expect(job.listing).toContain('DATA ARE NOT AVAILABLE FOR ELEMENT NO.');

  const error = catchMopac7Error(() => parseMopac7Output(job.listing));

  expect(error.code).toBe('parameters');
  expect(error.message).toContain('DATA ARE NOT AVAILABLE FOR ELEMENT NO.');
});

test('a keyword MOPAC does not know is reported with the keywords code', async () => {
  const job = await runMopac7Job(
    deck('AM1 1SCF XYZ VECTORS GEO-OK NOSUCHKEYWORD'),
  );

  expect(job.listing).toContain('UNRECOGNIZED KEY-WORDS');

  const error = catchMopac7Error(() => parseMopac7Output(job.listing));

  expect(error.code).toBe('keywords');
  expect(error.message).toContain('NOSUCHKEYWORD');
});

test('a keyword MOPAC does not know stops the run, and the error names it', async () => {
  const error = await catchMopac7ErrorAsync(() =>
    mopac7({ ...MOLECULES.water, keywords: ['NOSUCHKEYWORD'] }),
  );

  expect(error.code).toBe('keywords');
  expect(error.message).toBe(
    'MOPAC stopped: UNRECOGNIZED KEY-WORDS: ( NOSUCHKEYWORD)',
  );
});

test('DEBUG reports an unknown keyword instead of stopping, and keeps ALLVEC', async () => {
  // wrtkey.f stops on a keyword it does not consume unless DEBUG is set, in
  // which case it lists them and carries on.
  const result = await mopac7({
    ...MOLECULES.water,
    keywords: ['DEBUG', 'NOSUCHKEYWORD'],
  });

  expect(result.unknownKeywords).toStrictEqual(['NOSUCHKEYWORD']);
  expect(result.heatOfFormation).toBe(-59.17072);
});

test('an amide runs by default, and says why when MOPAC is given neither keyword', async () => {
  // moldat.f finds the H-N-C=O group in formamide and stops on it unless the
  // deck carries MMOK or NOMM. Every deck this package builds carries one.
  const result = await mopac7(EXTRA_MOLECULES.formamide);

  expect(result.heatOfFormation).toBe(-43.25785);
  expect(result.ionizationPotential).toBe(10.67583);

  const bare = buildMopac7Input(EXTRA_MOLECULES.formamide).replace(' MMOK', '');
  const job = await runMopac7Job(bare);
  const error = catchMopac7Error(() => parseMopac7Output(job.listing));

  expect(error.code).toBe('keywords');
  expect(error.message).toBe(
    'MOPAC stopped: THIS SYSTEM CONTAINS -HNCO- GROUPS. / ' +
      'YOU MUST SPECIFY "NOMM" OR "MMOK" REGARDING MOLECULAR MECHANICS CORRECTION',
  );
});

test('six amide groups in one system are still six amide groups', async () => {
  // moldat.f fills NHCO(4,120) two entries per amide N-H, with the bound check
  // patches/fortran/0012-nhco-bound.patch adds; the archive's NHCO(4,20) ran out
  // at five formamides and the twenty-first write landed on NNHCO itself.
  const elements: string[] = [];
  const coordinates: number[][] = [];
  for (let copy = 0; copy < 6; copy++) {
    for (let atom = 0; atom < 6; atom++) {
      elements.push(EXTRA_MOLECULES.formamide.elements[atom] as string);
      const row = EXTRA_MOLECULES.formamide.coordinates[atom] as number[];
      coordinates.push([
        (row[0] as number) + copy * 12,
        row[1] as number,
        row[2] as number,
      ]);
    }
  }
  const six = await mopac7({ elements, coordinates });
  const one = await mopac7(EXTRA_MOLECULES.formamide);

  expect(elements).toHaveLength(36);
  expect(six.basis).toHaveLength(6 * 15);
  expect(one.heatOfFormation).toBe(-43.25785);
  // Twelve angstrom apart, so six of them are six times one of them but for
  // 0.06 kcal/mol per copy of residual electrostatics.
  expect(six.heatOfFormation).toBe(-259.21089);
});

test('MMOK and NOMM differ in the heat of formation and in nothing else', async () => {
  const mmok = await mopac7(EXTRA_MOLECULES.formamide);
  const nomm = await mopac7({
    ...EXTRA_MOLECULES.formamide,
    amideCorrection: 'nomm',
  });

  expect(mmok.orbitals).toStrictEqual(nomm.orbitals);
  expect(Array.from(mmok.coefficients)).toStrictEqual(
    Array.from(nomm.coefficients),
  );
  expect(Array.from(mmok.charges)).toStrictEqual(Array.from(nomm.charges));
  expect(mmok.totalEnergy).toBe(nomm.totalEnergy);
});

test('an SCF that cannot converge throws with the scf code and keeps the listing', async () => {
  // A badly crowded H-F-F fragment with MOPAC's own iteration cap set to three:
  // iter.f gives up and writes its "FAILED TO ACHIEVE SCF" banner, which is the
  // string the parser has to recognise.
  const job = await runMopac7Job(
    deck('AM1 1SCF XYZ VECTORS GEO-OK CHARGE=0 ITRY=3', [
      ' H      0.00000000 0     0.00000000 0     0.00000000 0   0   0   0',
      ' F      0.30000000 0     0.00000000 0     0.00000000 0   1   0   0',
      ' F      0.30000000 0     1.00000000 0     0.00000000 0   1   2   0',
    ]),
  );

  expect(job.listing).toContain('FAILED TO ACHIEVE SCF');

  const error = catchMopac7Error(() => parseMopac7Output(job.listing));

  expect(error.code).toBe('scf');
  expect(error.output).toBe(job.listing);
});

test('runMopac7Job returns MOPAC failures instead of throwing them', async () => {
  const input = deck('AM1 1SCF XYZ VECTORS GEO-OK NOSUCHKEYWORD');
  const job = await runMopac7Job(input);

  expect(job.input).toBe(input);
  expect(job.exitCode).toBe(0);
  expect(job.listing).toContain('UNRECOGNIZED KEY-WORDS');
  expect(job.listing).toContain('CALCULATION STOPPED TO AVOID WASTING TIME');
});

test("an empty deck comes back as MOPAC's own one-line complaint", async () => {
  // gettxt.f reads end-of-file and stops before printing anything else.
  const job = await runMopac7Job('');

  expect(job.listing).toBe(' INPUT FILE MISSING OR EMPTY');
  expect(job.exitCode).toBe(0);
});

test('a Mopac7Error thrown by mopac7 carries the deck it was given', async () => {
  // Hydrogen fluoride at 0.3 A under MINDO/3, capped at two SCF iterations.
  const error = await catchMopac7ErrorAsync(() =>
    mopac7({
      elements: ['H', 'F'],
      coordinates: [
        [0, 0, 0],
        [0.3, 0, 0],
      ],
      method: 'MINDO3',
      keywords: ['ITRY=2'],
    }),
  );

  expect(error.code).toBe('scf');
  expect(error.input).toContain('MINDO3');
  expect(error.output).toContain('FAILED TO ACHIEVE SCF');
});
