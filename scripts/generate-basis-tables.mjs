/**
 * Write `src/basis/slaterExponents.ts`, `src/basis/sto6g.ts` and the Fortran
 * excerpt they are checked against, straight out of MOPAC 7's own sources.
 *
 *   node scripts/generate-basis-tables.mjs
 *
 * It needs the MOPAC archive under `build/`, which `npm run build-wasm` fetches
 * and which is not committed, and it refuses to run unless that tree hashes to
 * exactly the `source.treeSha256` recorded in `wasm/BUILD.json` — so a table can
 * only ever come from the archive this build's WebAssembly was compiled from.
 *
 * What is read, and why:
 *
 *   block.f    DATA ZSM/ZPM, ZSAM1/ZPAM1, ZSPM3/ZPPM3, ZS3/ZP3   the exponents
 *              DATA NATORB                                       orbitals/atom
 *   diat.f     DATA NPQ                                          principal n
 *   setupg.f   SETUPG's ALLZ/ALLC assignments                    STO-6G
 *   moldat.f   ZS(I)=ZSM(I) and friends                  which array is which
 *   esp.rof    ELESP's zeta² scaling and normalisation   how a shell contracts
 *
 * Nothing is transcribed: `src/basis/__tests__/parseBasisFortran.ts` does the
 * reading, `lib/basis-excerpt.mjs` copies the lines it read out verbatim, and
 * `lib/basis-modules.mjs` lays the parse out as TypeScript. The excerpt is
 * re-parsed here and must reproduce the full sources before anything is written.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { format, resolveConfig } from 'prettier';

import { parseBasisFortran } from '../src/basis/__tests__/parseBasisFortran.ts';

import { buildBasisExcerpt } from './lib/basis-excerpt.mjs';
import {
  exponentsModule,
  moduleHeader,
  sto6gModule,
} from './lib/basis-modules.mjs';

const ROOT = join(import.meta.dirname, '..');
// The pristine archive, not the patched build/mopac7-fortran beside it: only its
// digest is pinned. `block.f`, `diat.f`, `setupg.f` and `esp.rof` are
// byte-identical in the two — checked below — so these are the very tables the
// WebAssembly runs on.
const FORTRAN = join(ROOT, 'build', 'mopac-archive', '1993_MOPAC7');
const PATCHED = join(ROOT, 'build', 'mopac7-fortran');
const EXCERPT = join(
  ROOT,
  'src',
  'basis',
  '__tests__',
  'data',
  'mopac7-basis-source.f',
);
/** The files that carry numbers, as opposed to the two read for provenance. */
const DATA_FILES = ['block.f', 'diat.f', 'setupg.f'];

const build = JSON.parse(
  readFileSync(join(ROOT, 'wasm', 'BUILD.json'), 'utf8'),
);
const treeSha256 = hashTree(FORTRAN);
if (treeSha256 !== build.source.treeSha256) {
  throw new Error(
    `${relative(ROOT, FORTRAN)} hashes to ${treeSha256}, but wasm/BUILD.json records ${build.source.treeSha256}`,
  );
}

const sources = new Map();
for (const name of [...DATA_FILES, 'moldat.f', 'esp.rof']) {
  const text = readFileSync(join(FORTRAN, name), 'utf8');
  // `moldat.f` is the one file here `patches/fortran/*` touches, and only for
  // COMMON layout and SIZES; nothing it contributes is a number.
  if (
    name !== 'moldat.f' &&
    text !== readFileSync(join(PATCHED, name), 'utf8')
  ) {
    throw new Error(
      `${name} differs between the archive and the patched build`,
    );
  }
  sources.set(name, text.split('\n'));
}

const excerptText = buildBasisExcerpt(sources, build.source);
// Only the three files that carry numbers: `esp.rof` holds SETUP3's STO-3G table
// under the same `ALLZ`/`ALLC` names, which would shadow the STO-6G one.
const fromSources = parseBasisFortran(
  DATA_FILES.map((name) => sources.get(name).join('\n')).join('\n'),
);
const tables = parseBasisFortran(excerptText);
assertSame(fromSources, tables);

writeFileSync(EXCERPT, excerptText);
console.log(
  `wrote ${relative(ROOT, EXCERPT)} (${excerptText.split('\n').length - 1} lines)`,
);
await writeFormatted(
  'src/basis/sto6g.ts',
  sto6gModule(tables, moduleHeader(build.source, 'setupg.f', 'SETUPG')),
);
await writeFormatted(
  'src/basis/slaterExponents.ts',
  exponentsModule(
    tables,
    moduleHeader(
      build.source,
      'block.f',
      'DATA ZSM/ZPM, ZSAM1/ZPAM1, ZSPM3/ZPPM3, ZS3/ZP3, NATORB',
    ),
  ),
);

/**
 * Format with the repository's own prettier configuration and write.
 * @param {string} path - Repository-relative destination.
 * @param {string} code - The unformatted module source.
 * @returns {Promise<void>} When it is written.
 */
async function writeFormatted(path, code) {
  const full = join(ROOT, path);
  const formatted = await format(code, {
    ...(await resolveConfig(full)),
    filepath: full,
  });
  writeFileSync(full, formatted);
  console.log(`wrote ${path} (${formatted.split('\n').length - 1} lines)`);
}

/**
 * Fail unless the excerpt reproduces the full sources exactly.
 * @param {object} full - Parsed from the archive.
 * @param {object} excerptTables - Parsed from the excerpt.
 */
function assertSame(full, excerptTables) {
  const left = JSON.stringify(full, replacer);
  const right = JSON.stringify(excerptTables, replacer);
  if (left !== right) {
    throw new Error('the excerpt does not reproduce the archive tables');
  }
}

/**
 * JSON replacer that makes a `Map` comparable.
 * @param {string} _key - Ignored.
 * @param {unknown} value - The value being serialised.
 * @returns {unknown} A plain equivalent.
 */
function replacer(_key, value) {
  return value instanceof Map ? Object.fromEntries(value) : value;
}

/**
 * `sha256` of `find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a
 * 256`, the same digest `scripts/build-wasm.sh` pins the archive with.
 * @param {string} directory - The archive directory.
 * @returns {string} The hex digest.
 */
function hashTree(directory) {
  const paths = [];
  for (const name of readdirSync(directory)) {
    if (statSync(join(directory, name)).isFile()) paths.push(`./${name}`);
  }
  const outer = createHash('sha256');
  for (const path of paths.toSorted()) {
    const bytes = readFileSync(join(directory, path));
    outer.update(
      `${createHash('sha256').update(bytes).digest('hex')}  ${path}\n`,
    );
  }
  return outer.digest('hex');
}
