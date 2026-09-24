/**
 * Run one MOPAC deck through the built wasm module.
 *
 * This is the build-time harness, deliberately minimal: the published package
 * will wrap the same three moves in a real API. The three moves, and why:
 *
 *   MEMFS, not NODERAWFS. -sNODERAWFS=1 aborts inside libf2c's f_init with
 *     emscripten's own "Assertion failed: value (18446744073709552000) too
 *     large to write as 32-bit value" from ___syscall_fstat64.
 *   ENV is set inside preRun. Assigning Module.ENV after instantiation is too
 *     late and MOPAC then reports "INPUT FILE MISSING OR EMPTY".
 *   _fflush(0) after callMain. libf2c writes the listing through a buffered
 *     FILE* and nothing flushes it when main returns, so the file is silently
 *     truncated at the last buffer boundary (water PM3: 11,619 of 11,915 B).
 *   one module instance per deck. MOPAC 7 keeps its whole state in Fortran
 *     COMMON with F77 static/SAVE semantics, so a second run in the same
 *     instance inherits the first one's converged density and keyword flags.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { decode } from 'uint8-base64';

/**
 * Run one deck and return the listing it produced.
 * @param {string} wasmDirectory - Directory holding mopac7.mjs and mopac7.wasm.
 * @param {string} deck - The MOPAC input deck, keywords line first.
 * @returns {Promise<{text: string, stdout: string, initMs: number, runMs: number, exitCode: number|string}>}
 *   The FOR006 listing plus timings.
 */
export async function runDeck(wasmDirectory, deck) {
  const { factory, compiled } = await load(wasmDirectory);
  const stdout = [];
  const beforeInit = performance.now();
  const module = await factory({
    instantiateWasm(imports, onSuccess) {
      // The glue is linked -sENVIRONMENT=web,worker, so it would otherwise try
      // to fetch its .wasm. Handing it the compiled module skips that and skips
      // recompiling for every deck.
      void WebAssembly.instantiate(compiled, imports).then((instance) => {
        onSuccess(instance, compiled);
      });
      return {};
    },
    print: (line) => stdout.push(line),
    printErr: (line) => stdout.push(line),
    preRun: [
      (instance) => {
        instance.ENV.FOR005 = '/job.dat';
        instance.ENV.FOR006 = '/job.out';
        instance.FS.writeFile('/job.dat', deck);
      },
    ],
  });
  const initMs = performance.now() - beforeInit;

  const beforeRun = performance.now();
  let exitCode = 'thrown';
  try {
    exitCode = module.callMain([]);
  } catch (error) {
    stdout.push(
      `THROWN ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // libf2c writes unit 6 through a buffered FILE*, and with EXIT_RUNTIME off
  // nothing flushes it when main returns: without this the listing is silently
  // cut at the last buffer boundary.
  try {
    module._fflush(0);
  } catch {
    // Nothing to do: the collected stdout is still the best diagnostic.
  }
  const runMs = performance.now() - beforeRun;

  let text;
  try {
    text = new TextDecoder().decode(module.FS.readFile('/job.out'));
  } catch {
    // mopac.f leaves unit 6 unopened in some paths, so the listing lands on
    // stdout instead of FOR006.
    text = stdout.join('\n');
  }
  return { text, stdout: stdout.join('\n'), initMs, runMs, exitCode };
}

const loaded = new Map();

// mopac7.mjs and mopac7.wasm are the raw linker output and are gitignored, so a
// fresh clone has only the committed glue.js plus the embedded payload. Fall back
// to those, which is also exactly what the published package runs, so
// `npm run verify-wasm` works without building first.
async function load(wasmDirectory) {
  const cached = loaded.get(wasmDirectory);
  if (cached !== undefined) return cached;
  const raw = join(wasmDirectory, 'mopac7.mjs');
  const entry = existsSync(raw)
    ? {
        factory: await defaultExport(raw),
        compiled: await WebAssembly.compile(
          readFileSync(join(wasmDirectory, 'mopac7.wasm')),
        ),
      }
    : {
        factory: await defaultExport(join(wasmDirectory, 'glue.js')),
        compiled: await compileEmbedded(join(wasmDirectory, 'data.js')),
      };
  loaded.set(wasmDirectory, entry);
  return entry;
}

// The same three moves as src/wasm/compileMopac7.ts, but reading the payload of
// the directory under test rather than the repository's own, so --wasm DIR still
// means DIR.
async function compileEmbedded(file) {
  const { wasmGzipBase64 } = await import(pathToFileURL(file).href);
  const gzipped = decode(new TextEncoder().encode(wasmGzipBase64));
  const stream = new Blob([gzipped])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return WebAssembly.compile(await new Response(stream).arrayBuffer());
}

async function defaultExport(file) {
  const imported = await import(pathToFileURL(file).href);
  const factory = imported.default;
  if (typeof factory !== 'function') {
    throw new Error(`${file} does not default-export a factory function`);
  }
  return factory;
}
