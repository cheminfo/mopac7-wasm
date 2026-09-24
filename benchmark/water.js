/**
 * Where a MOPAC 7 calculation's time goes, and what caching the compiled module
 * is worth.
 *
 * Run it with `npm run benchmark`. Both cases do exactly the same chemistry —
 * water at AM1, single point, every orbital printed — and differ only in whether
 * the 789 kB WebAssembly module is compiled once for the process or once per
 * calculation. Each case keeps its own copy of the code it measures, so the two
 * cannot share an inline cache.
 */
import Benchmark from 'benchmark';
import { decode } from 'uint8-base64';

import { buildMopac7Input, mopac7 } from '../src/index.ts';
import { wasmGzipBase64 } from '../wasm/data.js';
import factory from '../wasm/glue.js';

const WATER = {
  elements: ['O', 'H', 'H'],
  coordinates: [
    [0, 0.066772, 0],
    [0.763466, -0.529952, 0],
    [-0.763466, -0.529952, 0],
  ],
  method: 'AM1',
};

// rules/performance.md: minSamples and maxTime are ignored on run(), so they go
// on every add() instead.
const options = { defer: true, minSamples: 30, maxTime: 30 };
const rates = [];

// Warm the cache and print the value both cases produce, so the timings below
// can be checked for equivalence at a glance.
const warm = await mopac7(WATER);
process.stdout.write(
  `water AM1: heat of formation ${warm.heatOfFormation} kcal/mol, ` +
    `ionisation potential ${warm.ionizationPotential} eV, ` +
    `${warm.orbitals.length} orbitals, ${wasmGzipBase64.length} payload characters\n\n`,
);

new Benchmark.Suite()
  .add(
    'mopac7(), module compiled once per process',
    (deferred) => {
      void mopac7(WATER).then(() => deferred.resolve());
    },
    options,
  )
  .add(
    'the same run, module decoded and compiled every call',
    (deferred) => {
      void runWithoutCache().then(() => deferred.resolve());
    },
    options,
  )
  .on('cycle', (event) => {
    const { name, hz, stats } = event.target;
    rates.push(hz);
    process.stdout.write(
      `${String(name).padEnd(52)} ${(1000 / hz).toFixed(2)} ms/run  ` +
        `±${stats.rme.toFixed(1)}%  ${stats.sample.length} samples\n`,
    );
  })
  .on('complete', () => {
    process.stdout.write(
      `\ncaching the compiled module is ${(Math.max(...rates) / Math.min(...rates)).toFixed(2)}x\n`,
    );
  })
  .run();

/**
 * The same calculation with nothing cached: decode, gunzip and compile per call.
 * @returns {Promise<number>} The length of the listing, so nothing is optimised away.
 */
async function runWithoutCache() {
  const gzipped = decode(new TextEncoder().encode(wasmGzipBase64));
  const stream = new Blob([gzipped])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const module = await WebAssembly.compile(
    await new Response(stream).arrayBuffer(),
  );
  const input = buildMopac7Input(WATER);
  const runtime = await factory({
    instantiateWasm(imports, onSuccess) {
      void WebAssembly.instantiate(module, imports).then((instance) => {
        onSuccess(instance, module);
      });
      return {};
    },
    print: () => undefined,
    printErr: () => undefined,
    preRun: [
      (instance) => {
        instance.ENV.FOR005 = '/job.dat';
        instance.ENV.FOR006 = '/job.out';
        instance.FS.writeFile('/job.dat', input);
      },
    ],
  });
  runtime.callMain([]);
  runtime._fflush(0);
  return new TextDecoder().decode(runtime.FS.readFile('/job.out')).length;
}
