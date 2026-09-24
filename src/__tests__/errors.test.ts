import { expect, test } from 'vitest';

import { mopac7 } from '../mopac7.ts';
import { parseMopac7Output } from '../output/parseMopac7Output.ts';
import { runMopac7Job } from '../wasm/runMopac7Job.ts';

import { catchMopac7Error, catchMopac7ErrorAsync } from './catchMopac7Error.ts';
import { MOLECULES } from './molecules.ts';

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

test('DEBUG turns an unknown keyword into a reported one instead of a failure', async () => {
  // wrtkey.f stops on an unrecognised keyword UNLESS DEBUG is set, and ALLVEC
  // needs DEBUG — so a typo would otherwise pass unnoticed. It comes back in
  // `unknownKeywords`.
  const result = await mopac7({
    ...MOLECULES.water,
    keywords: ['NOSUCHKEYWORD'],
  });

  expect(result.unknownKeywords).toStrictEqual(['NOSUCHKEYWORD']);
  expect(result.heatOfFormation).toBe(-59.17072);
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
