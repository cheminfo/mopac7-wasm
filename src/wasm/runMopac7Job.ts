import factory from '../../wasm/glue.js';
import { Mopac7Error } from '../Mopac7Error.ts';
import type { Mopac7Job } from '../types.ts';

import { compileMopac7 } from './compileMopac7.ts';

/**
 * Run one MOPAC 7 deck and return the listing, whatever MOPAC made of it. This
 * is the escape hatch below the high-level entry point: it never throws for
 * MOPAC's own failures — a rejected keyword, a faulty geometry, an SCF that did
 * not converge all come back as a listing to read — and throws only when the
 * WebAssembly module itself trapped.
 *
 * Every call builds a fresh module instance, and that is not a choice: MOPAC 7
 * is Fortran 77 whose entire state lives in `SAVE`d COMMON blocks, so a second
 * `main` in the same instance inherits the first run's converged density and
 * keyword flags, and in practice aborts. Instantiating costs about 0.6 ms once
 * the module is compiled, which {@link compileMopac7} does once per realm.
 * @param input - A MOPAC input deck, keyword line first.
 * @returns The deck, the listing, MOPAC's stderr and the exit code.
 * @throws {Mopac7Error} With `code: 'aborted'` when the module trapped.
 */
export async function runMopac7Job(input: string): Promise<Mopac7Job> {
  const module = await compileMopac7();
  const stdout: string[] = [];
  const stderr: string[] = [];

  const runtime = await factory({
    instantiateWasm(imports, onSuccess) {
      // Feeding the already compiled module here is what keeps a calculation at
      // an instantiation rather than a compilation.
      void WebAssembly.instantiate(module, imports).then((instance) => {
        onSuccess(instance, module);
      });
      return {};
    },
    print: (line: string) => stdout.push(line),
    printErr: (line: string) => stderr.push(line),
    preRun: [
      (instance) => {
        // ENV has to be written inside preRun: libf2c captures the environment
        // when the runtime starts, so assigning after instantiation is too late
        // and MOPAC then reports "INPUT FILE MISSING OR EMPTY".
        instance.ENV.FOR005 = INPUT_PATH;
        instance.ENV.FOR006 = LISTING_PATH;
        instance.ENV.FOR009 = '/job.res';
        instance.ENV.FOR010 = '/job.den';
        instance.ENV.FOR011 = '/job.log';
        instance.ENV.FOR012 = '/job.arc';
        instance.FS.writeFile(INPUT_PATH, input);
      },
    ],
  });

  let exitCode: number | null = null;
  let thrown: unknown;
  try {
    exitCode = runtime.callMain([]);
  } catch (error) {
    thrown = error;
  }
  // MOPAC writes its listing through libf2c's buffered FILE*, and the runtime
  // is deliberately not torn down, so nothing flushes it: without this the
  // listing loses everything after the last buffer boundary -- on water PM3,
  // 296 of 11,915 bytes, which is the whole final geometry block.
  try {
    runtime._fflush(0);
  } catch {
    // The module trapped hard enough that even flushing fails; the listing
    // collected so far is still the best diagnostic there is.
  }

  const listing = readListing(runtime, stdout);
  if (thrown !== undefined && listing.length === 0) {
    // An emscripten abort reaches JavaScript as a bare "RuntimeError:
    // unreachable" with no message, so whatever MOPAC printed first is the only
    // diagnostic there is.
    throw new Mopac7Error(
      'aborted',
      `the MOPAC WebAssembly module trapped: ${describe(thrown)}`,
      {
        input,
        output: stderr.join('\n'),
      },
    );
  }

  return { input, listing, diagnostics: stderr.join('\n'), exitCode };
}

const INPUT_PATH = '/job.dat';
const LISTING_PATH = '/job.out';

// MOPAC 7.00's mopac.f opens unit 6, so the listing lands on FOR006. Other
// packagings of MOPAC 7 leave it unopened and the listing arrives on stdout, so
// both are read and the file wins when it has content.
function readListing(
  runtime: { FS: { readFile: (path: string) => Uint8Array } },
  stdout: readonly string[],
): string {
  let fromFile = '';
  try {
    fromFile = new TextDecoder().decode(runtime.FS.readFile(LISTING_PATH));
  } catch {
    fromFile = '';
  }
  return fromFile.length > 0 ? fromFile : stdout.join('\n');
}

function describe(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message;
  return String(thrown);
}
