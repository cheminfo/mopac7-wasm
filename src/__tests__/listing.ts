import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read one committed MOPAC listing from `__tests__/data`.
 *
 * `water-am1.out` and `benzene-am1.out` are this build's own output for
 * `verification/decks/AM1/{water,benzene}.dat`, committed verbatim — DEBUG's
 * per-iteration eigenvector dumps included, because skipping them to reach the
 * converged block is the hardest thing the parser does.
 * `hydrogen-cyanide-am1-native.out` is a native run's listing, from this
 * repository's own native build of the same translated C.
 * @param name - The fixture's file name.
 * @returns The listing.
 */
export function listing(name: string): string {
  return readFileSync(join(import.meta.dirname, 'data', name), 'utf8');
}
