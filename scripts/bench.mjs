/**
 * Time the built wasm under node: cold module init, then per-deck SCF.
 *
 * Every number is a median of `--repeats` runs of the same deck, each in a
 * FRESH module instance (MOPAC keeps its state in Fortran COMMON with F77
 * static/SAVE semantics, so reusing an instance would measure a warm density
 * matrix, not a calculation). Cold init is measured separately, once per
 * process, because after the first instantiation the wasm module is compiled
 * and cached by the engine and every later init is warm.
 *
 * Usage: node scripts/bench.mjs [--wasm DIR] [--repeats 7] [--json FILE]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..');
const options = readOptions(process.argv.slice(2));
const wasmDirectory = options.wasm ?? join(REPO_ROOT, 'wasm');
const repeats = Number(options.repeats ?? 7);
const deckDirectory = join(REPO_ROOT, 'verification', 'timing');

const wasmSource = readFileSync(join(wasmDirectory, 'mopac7.wasm'));
const wasmBytes = wasmSource.length;
const glueBytes = readFileSync(join(wasmDirectory, 'mopac7.mjs')).length;

// MOPAC's listing is not part of any measurement here.
function discard() {
  return undefined;
}

// Cold: the very first import and compile in this process, nothing cached.
const beforeImport = performance.now();
const imported = await import(`file://${wasmDirectory}/mopac7.mjs`);
const factory = imported.default;
const importMs = performance.now() - beforeImport;
const beforeCompile = performance.now();
const compiled = await WebAssembly.compile(wasmSource);
const compileMs = performance.now() - beforeCompile;

// The glue is linked -sENVIRONMENT=web,worker, so it must be handed the compiled
// module instead of being left to fetch its .wasm.
const silent = {
  print: discard,
  printErr: discard,
  instantiateWasm(imports, onSuccess) {
    void WebAssembly.instantiate(compiled, imports).then((instance) => {
      onSuccess(instance, compiled);
    });
    return {};
  },
};

const beforeCold = performance.now();
await factory(silent);
const coldInstantiateMs = performance.now() - beforeCold;

// Warm: the same call once the engine has seen the module.
const warmSamples = [];
for (let index = 0; index < repeats; index++) {
  const before = performance.now();
  // eslint-disable-next-line no-await-in-loop -- one instantiation at a time is the measurement
  await factory(silent);
  warmSamples.push(performance.now() - before);
}

const report = {
  wasmDirectory,
  node: process.version,
  repeats,
  bytes: { 'mopac7.wasm': wasmBytes, 'mopac7.mjs': glueBytes },
  init: {
    importMs: round(importMs),
    compileMs: round(compileMs),
    coldInstantiateMs: round(coldInstantiateMs),
    warmInstantiateMedianMs: round(median(warmSamples)),
  },
  decks: {},
};

process.stdout.write(
  `import ${round(importMs)} ms   compile ${round(compileMs)} ms   ` +
    `cold instantiate ${round(coldInstantiateMs)} ms   ` +
    `warm instantiate ${round(median(warmSamples))} ms (median of ${repeats})\n\n` +
    `${'deck'.padEnd(14)}${'atoms'.padStart(6)}${'basis'.padStart(7)}${'median ms'.padStart(11)}${'min'.padStart(8)}${'max'.padStart(8)}  result\n`,
);

for (const file of readdirSync(deckDirectory)
  .filter((name) => name.endsWith('.dat'))
  .toSorted()) {
  const deck = readFileSync(join(deckDirectory, file), 'utf8');
  const samples = [];
  let listing = '';
  for (let index = 0; index < repeats; index++) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design: one instance at a time
    const run = await timeOne(factory, deck);
    samples.push(run.ms);
    listing = run.listing;
  }
  const name = file.replace(/\.dat$/, '');
  const atoms = countAtoms(deck);
  const basis =
    /RHF CALCULATION, NO\. OF DOUBLY OCCUPIED LEVELS\s*=\s*(?<n>\d+)/.exec(
      listing,
    )?.groups?.n;
  const heat = /FINAL HEAT OF FORMATION\s*=\s*(?<value>-?[\d.]+)/.exec(listing)
    ?.groups?.value;
  const potential = /IONIZATION POTENTIAL\s*=\s*(?<value>-?[\d.]+)/.exec(
    listing,
  )?.groups?.value;
  report.decks[name] = {
    atoms,
    occupiedLevels: basis === undefined ? null : Number(basis),
    medianMs: round(median(samples)),
    minMs: round(Math.min(...samples)),
    maxMs: round(Math.max(...samples)),
    heatOfFormationKcal: heat === undefined ? null : Number(heat),
    ionizationPotentialEv: potential === undefined ? null : Number(potential),
    converged: listing.includes('SCF FIELD WAS ACHIEVED'),
  };
  process.stdout.write(
    `${name.padEnd(14)}${String(atoms).padStart(6)}${String(basis ?? '?').padStart(7)}` +
      `${round(median(samples)).toFixed(2).padStart(11)}${round(
        Math.min(...samples),
      )
        .toFixed(2)
        .padStart(8)}` +
      `${round(Math.max(...samples))
        .toFixed(2)
        .padStart(8)}  ` +
      `HOF ${heat ?? '?'} kcal  IP ${potential ?? '?'} eV\n`,
  );
}

if (options.json !== undefined) {
  writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`\nwrote ${options.json}\n`);
}

// One deck in a fresh instance; the clock covers only callMain.
async function timeOne(factory, deck) {
  const module = await factory({
    ...silent,
    preRun: [
      (instance) => {
        instance.ENV.FOR005 = '/job.dat';
        instance.ENV.FOR006 = '/job.out';
        instance.FS.writeFile('/job.dat', deck);
      },
    ],
  });
  const before = performance.now();
  module.callMain([]);
  const ms = performance.now() - before;
  return {
    ms,
    listing: new TextDecoder().decode(module.FS.readFile('/job.out')),
  };
}

function countAtoms(deck) {
  let atoms = 0;
  const lines = deck.split('\n');
  for (let index = 3; index < lines.length; index++) {
    if (/^\s*[A-Za-z]{1,2}\s+-?[\d.]+/.test(lines[index])) atoms++;
  }
  return atoms;
}

function median(samples) {
  const sorted = samples.toSorted((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value) {
  return Math.round(value * 100) / 100;
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
