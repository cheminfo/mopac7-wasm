/**
 * Verify a freshly built wasm against the reference numbers, and against a
 * native build of the very same f2c output when one is present.
 *
 * Three independent checks:
 *
 *   1. water / AM1, the single-deck spot check, on the geometry in
 *      verification/water-am1-reference.dat. The heat of formation and the
 *      ionisation potential must be exactly -59.17072 kcal/mol and
 *      12.44564 eV.
 *   2. the 42 decks (3 methods x 14 molecules) of verification/decks, against
 *      verification/reference-mopac7.json. That file holds eigenvalues, the
 *      heat of formation and the ionisation potential, so that is what is
 *      compared; the largest absolute eigenvalue difference is reported per
 *      method, in eV.
 *   3. the same 42 decks under build/native/mopac7 when it exists: wasm against
 *      native, from identical C. This is the real wasm-correctness question and
 *      it compares EVERYTHING the package returns — eigenvalues, molecular
 *      orbital coefficients, Mulliken charges, electron densities, the dipole
 *      and the geometry — through the package's own parser, so the eigenvector
 *      phases are pinned before they are compared and a sign is not mistaken
 *      for a difference. See scripts/lib/compare-results.mjs for the tolerance
 *      of each block, and for why a degenerate orbital's coefficients are
 *      reported but never failed.
 *
 * Usage: node scripts/verify.mjs [--wasm DIR] [--native BINARY] [--json FILE]
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseMopac7Output } from '../src/output/parseMopac7Output.ts';

import { compareResults } from './lib/compare-results.mjs';
import { parseMopacOutput } from './lib/parse-mopac.mjs';
import { runDeck } from './lib/run-wasm.mjs';

const REPO_ROOT = join(import.meta.dirname, '..');
const options = readOptions(process.argv.slice(2));
const wasmDirectory = options.wasm ?? join(REPO_ROOT, 'wasm');
const nativeBinary =
  options.native ?? join(REPO_ROOT, 'build', 'native', 'mopac7');
const reference = JSON.parse(
  readFileSync(
    join(REPO_ROOT, 'verification', 'reference-mopac7.json'),
    'utf8',
  ),
);

const report = { wasmDirectory, checks: {} };
let failures = 0;

// --- 1. water / AM1 -------------------------------------------------------- //
{
  const deck = readFileSync(
    join(REPO_ROOT, 'verification', 'water-am1-reference.dat'),
    'utf8',
  );
  const { text, runMs, initMs } = await runDeck(wasmDirectory, deck);
  const parsed = parseMopacOutput(text);
  const expected = {
    heatOfFormationKcal: -59.17072,
    ionizationPotentialEv: 12.44564,
  };
  const ok =
    parsed.heatOfFormationKcal === expected.heatOfFormationKcal &&
    parsed.ionizationPotentialEv === expected.ionizationPotentialEv;
  if (!ok) failures++;
  report.checks.waterAm1 = { expected, got: parsed, ok, initMs, runMs };
  process.stdout.write(
    `water AM1   HOF ${parsed.heatOfFormationKcal} kcal  IP ${parsed.ionizationPotentialEv} eV  ` +
      `version ${parsed.version}  ${ok ? 'MATCH' : 'MISMATCH'}\n`,
  );
}

// --- 2 and 3. the 42 decks ------------------------------------------------- //
const haveNative = existsSync(nativeBinary);
if (!haveNative) {
  process.stdout.write(
    `\nno native binary at ${nativeBinary}; skipping the A/B\n`,
  );
}

for (const method of Object.keys(reference.methods)) {
  let worstReference = { molecule: null, eV: 0 };
  let levels = 0;
  const molecules = {};
  const worstNative = {};
  const diffs = [];
  const notes = [];

  for (const [molecule, want] of Object.entries(reference.methods[method])) {
    const deck = readFileSync(
      join(REPO_ROOT, 'verification', 'decks', method, `${molecule}.dat`),
      'utf8',
    );
    // eslint-disable-next-line no-await-in-loop -- one MOPAC instance per deck is deliberate: MOPAC 7's state lives in SAVEd COMMON blocks
    const wasmRun = await runDeck(wasmDirectory, deck);
    const got = parseMopacOutput(wasmRun.text);
    const occupied = got.eigenvaluesEv.slice(0, want.occupiedEnergiesEv.length);
    if (occupied.length !== want.occupiedEnergiesEv.length) {
      failures++;
      molecules[molecule] = {
        error: `got ${occupied.length} occupied levels, want ${want.occupiedEnergiesEv.length}`,
      };
      continue;
    }
    let maxReference = 0;
    for (let index = 0; index < occupied.length; index++) {
      const difference = Math.abs(
        occupied[index] - want.occupiedEnergiesEv[index],
      );
      if (difference > maxReference) maxReference = difference;
      levels++;
    }
    if (maxReference > worstReference.eV) {
      worstReference = { molecule, eV: maxReference };
    }

    let comparison = null;
    if (haveNative) {
      comparison = compareResults(
        parseMopac7Output(wasmRun.text),
        parseMopac7Output(runNative(nativeBinary, deck)),
      );
      for (const [field, summary] of Object.entries(comparison.fields)) {
        const current = worstNative[field];
        if (current === undefined || summary.worst > current.worst) {
          worstNative[field] = { molecule, worst: summary.worst };
        }
      }
      if (!comparison.ok) {
        failures++;
        for (const problem of comparison.problems) {
          diffs.push(`${method}/${molecule}  ${problem}`);
        }
      }
      for (const note of comparison.notes) {
        notes.push(`${method}/${molecule}  ${note}`);
      }
    }

    molecules[molecule] = {
      occupiedCount: occupied.length,
      maxAbsDifferenceToReferenceEv: round(maxReference),
      heatOfFormationKcal: got.heatOfFormationKcal,
      referenceHeatOfFormationKcal: want.heatOfFormationKcal,
      ionizationPotentialEv: got.ionizationPotentialEv,
      referenceIonizationPotentialEv: want.ionizationPotentialEv,
      againstNative:
        comparison === null
          ? null
          : { ok: comparison.ok, fields: rounded(comparison.fields) },
      runMs: round(wasmRun.runMs),
    };
  }

  report.checks[method] = {
    levels,
    worstAgainstReference: { ...worstReference, eV: round(worstReference.eV) },
    worstAgainstNative: haveNative ? rounded(worstNative) : null,
    diffs,
    notes,
    molecules,
  };
  process.stdout.write(
    `${method.padEnd(5)} ${String(levels).padStart(3)} levels  ` +
      `worst vs reference ${round(worstReference.eV).toFixed(6)} eV (${worstReference.molecule})\n`,
  );
  if (haveNative) {
    for (const [field, summary] of Object.entries(worstNative)) {
      process.stdout.write(
        `      vs native  ${field.padEnd(22)} ${summary.worst.toExponential(3)}  (${summary.molecule})\n`,
      );
    }
    for (const line of diffs) process.stdout.write(`      DIFF ${line}\n`);
    for (const line of notes) process.stdout.write(`      NOTE ${line}\n`);
  }
}

if (options.json !== undefined) {
  writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`\nwrote ${options.json}\n`);
}
process.stdout.write(
  failures === 0 ? '\nVERIFY OK\n' : `\nVERIFY FAILED (${failures})\n`,
);
process.exitCode = failures === 0 ? 0 : 1;

// MOPAC 7 is a file-in/file-out program: FOR005 in, FOR006 out.
function runNative(binary, deck) {
  const directory = mkdtempSync(join(tmpdir(), 'mopac7-native-'));
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'job.dat'), deck);
  try {
    execFileSync(binary, [], {
      cwd: directory,
      env: { ...process.env, FOR005: 'job.dat', FOR006: 'job.out' },
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      timeout: 600_000,
    });
  } catch {
    // MOPAC exits non-zero on a normal STOP; the output file is what matters.
  }
  return readFileSync(join(directory, 'job.out'), 'utf8');
}

function rounded(fields) {
  const out = {};
  for (const [name, summary] of Object.entries(fields)) {
    out[name] = { ...summary, worst: round(summary.worst) };
  }
  return out;
}

function round(value) {
  return Math.round(value * 1e9) / 1e9;
}

function readOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (key === undefined || !key.startsWith('--')) {
      throw new Error(`expected an option, found ${String(key)}`);
    }
    options[key.slice(2)] = argv[index + 1];
  }
  return options;
}
