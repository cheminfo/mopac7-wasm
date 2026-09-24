import { Mopac7Error } from './Mopac7Error.ts';
import { buildMopac7Input } from './input/buildMopac7Input.ts';
import { parseMopac7Output } from './output/parseMopac7Output.ts';
import type { Mopac7Options, Mopac7Result } from './types.ts';
import { runMopac7Job } from './wasm/runMopac7Job.ts';

/**
 * Run a MOPAC 7 calculation on a molecule and return everything the listing
 * carries: the heat of formation, the orbital energies, the molecular orbital
 * coefficients and their atomic orbital labels, the Mulliken charges and the
 * geometry MOPAC worked in.
 *
 * The first call decodes and compiles the embedded WebAssembly module, which
 * takes a few milliseconds; every call after that reuses it and only builds a
 * fresh instance. Anything MOPAC or this package objects to is thrown as a
 * {@link Mopac7Error} carrying the deck and the listing, never returned as a
 * half-filled result.
 *
 * Every number is the listing's own but for the sign of a coefficient: orbital
 * phases are arbitrary in any diagonaliser and are pinned to one convention
 * here, so they are the same on every build. See
 * {@link Mopac7Result.coefficients}.
 * @param options - The molecule and the calculation to run.
 * @returns The parsed result.
 * @throws {Mopac7Error} For bad options, a rejected deck, a failed SCF or an unreadable listing.
 * @example
 * ```ts
 * const result = await mopac7({
 *   elements: ['O', 'H', 'H'],
 *   coordinates: [
 *     [0, 0.066772, 0],
 *     [0.763466, -0.529952, 0],
 *     [-0.763466, -0.529952, 0],
 *   ],
 *   method: 'AM1',
 * });
 * result.heatOfFormation; // -59.17072 kcal/mol
 * result.ionizationPotential; // 12.44576 eV
 * ```
 */
export async function mopac7(options: Mopac7Options): Promise<Mopac7Result> {
  const input = buildMopac7Input(options);
  const job = await runMopac7Job(input);
  if (job.listing.length === 0) {
    throw new Mopac7Error('aborted', 'MOPAC produced no listing at all', {
      input,
      output: job.diagnostics,
    });
  }
  try {
    return parseMopac7Output(job.listing);
  } catch (error) {
    if (error instanceof Mopac7Error) {
      throw new Mopac7Error(error.code, error.message, {
        input,
        output: job.listing,
      });
    }
    throw error;
  }
}
