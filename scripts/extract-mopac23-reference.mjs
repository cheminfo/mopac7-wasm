/**
 * Write the OpenMOPAC 23 reference fixtures the basis tests compare against.
 *
 *   node scripts/extract-mopac23-reference.mjs <aux-dir> [<aux-dir> …]
 *
 * Each directory holds `<METHOD>/<job>.aux` files from a MOPAC 23 run with
 * `AUX(PRECISION=9,MOS=99999)`. MOPAC 23 prints, in the "Start of Input data"
 * section and so before the SCF, the three things MOPAC 7 prints nowhere:
 *
 *   AO_ZETA          the Slater exponent of every atomic orbital
 *   ATOM_PQN         its principal quantum number
 *   OVERLAP_MATRIX   the analytic Slater overlap, packed lower triangle
 *
 * That makes MOPAC 23 the only independent check on tables MOPAC 7 keeps to
 * itself. Two fixtures come out:
 *
 *   data/mopac23-exponents.json   one row per hamiltonian and element
 *   data/mopac23-overlap.json     the four molecules the overlap is rebuilt for
 *
 * MOPAC 23 is not in this repository and neither are the runs, which is why the
 * fixtures are committed and this script is not part of any npm script.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'src', 'basis', '__tests__', 'data');
/** The molecules whose whole overlap matrix is kept: one oxygen, a carbonyl, a pure aromatic, an aza-aromatic. */
const OVERLAP_JOBS = new Set(['water', 'formaldehyde', 'benzene', 'pyridine']);
/** MOPAC 7's four hamiltonians, minus MINDO/3, which MOPAC 23 dropped. */
const METHODS = new Set(['MNDO', 'AM1', 'PM3']);

const directories = process.argv.slice(2);
if (directories.length === 0) {
  throw new Error(
    'usage: node scripts/extract-mopac23-reference.mjs <aux-dir> …',
  );
}

const exponents = new Map();
const overlaps = new Map();
let version = null;
let files = 0;

for (const directory of directories) {
  for (const path of auxFiles(directory)) {
    const text = readFileSync(path, 'utf8');
    const method = single(text, 'METHOD');
    if (method === null || !METHODS.has(method)) continue;
    files++;
    version ??= single(text, 'MOPAC_VERSION');
    const elements = block(text, 'ATOM_EL');
    const atomIndex = block(text, 'AO_ATOMINDEX').map(Number);
    const types = block(text, 'ATOM_SYMTYPE');
    const zeta = block(text, 'AO_ZETA').map(Number);
    const pqn = block(text, 'ATOM_PQN').map(Number);

    for (let ao = 0; ao < zeta.length; ao++) {
      const element = elements[atomIndex[ao] - 1];
      const key = `${method} ${element}`;
      const row = exponents.get(key) ?? {
        method,
        element,
        principalQuantumNumber: pqn[ao],
        zetaS: null,
        zetaP: null,
      };
      if (types[ao] === 'S') row.zetaS = zeta[ao];
      else row.zetaP = zeta[ao];
      if (row.principalQuantumNumber !== pqn[ao]) {
        throw new Error(
          `${path}: ${element} has two principal quantum numbers`,
        );
      }
      exponents.set(key, row);
    }

    const job = (path.split('/').at(-1) ?? '').replace(/\.aux$/, '');
    const overlap = block(text, 'OVERLAP_MATRIX').map(Number);
    if (!OVERLAP_JOBS.has(job) || overlap.length === 0) continue;
    overlaps.set(`${method}/${job}`, {
      method,
      molecule: job,
      elements,
      coordinates: block(text, 'ATOM_X').map(Number),
      atomicOrbitals: types.map((type, index) => ({
        atomIndex: atomIndex[index] - 1,
        element: elements[atomIndex[index] - 1],
        type: type === 'S' ? 'S' : `P${type.slice(1).toLowerCase()}`,
      })),
      overlapLowerTriangle: overlap,
    });
  }
}

const provenance = {
  program: `OpenMOPAC ${version}`,
  blocks: ['AO_ZETA', 'ATOM_PQN', 'OVERLAP_MATRIX', 'ATOM_X', 'ATOM_SYMTYPE'],
  generatedBy: 'scripts/extract-mopac23-reference.mjs',
  auxFilesRead: files,
};

writeJson('mopac23-exponents.json', {
  what: 'The valence Slater exponent and principal quantum number OpenMOPAC 23 prints for every element, per hamiltonian',
  provenance,
  rows: [...exponents.values()].toSorted(
    (left, right) =>
      left.method.localeCompare(right.method) ||
      left.element.localeCompare(right.element),
  ),
});
writeJson('mopac23-overlap.json', {
  what: "OpenMOPAC 23's own analytic Slater OVERLAP_MATRIX, with the geometry and atomic-orbital order it computed it in",
  note: 'Coordinates are ångström. MOPAC 23 converts them with the CODATA bohr, so a comparison must pass bohrPerAngstrom: 0.529177210903.',
  provenance,
  jobs: [...overlaps.keys()].toSorted().map((key) => overlaps.get(key)),
});

/**
 * Every `.aux` file under a directory, recursively.
 * @param {string} directory - Where to look.
 * @returns {string[]} The paths, sorted.
 */
function auxFiles(directory) {
  const found = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...auxFiles(path));
    else if (name.endsWith('.aux')) found.push(path);
  }
  return found.toSorted();
}

/**
 * Read one `NAME=value` line of a `.aux` file.
 * @param {string} text - The file.
 * @param {string} name - The key.
 * @returns {string|null} The value, or `null`.
 */
function single(text, name) {
  return new RegExp(String.raw`\n ${name}=(\S+)`).exec(text)?.[1] ?? null;
}

/**
 * Read one whitespace-separated `NAME[count]=` or `NAME:UNIT[count]=` block.
 * @param {string} text - The file.
 * @param {string} name - The block name, without the count or the unit.
 * @returns {string[]} Its tokens, or an empty array when the block is absent.
 */
function block(text, name) {
  let start = text.indexOf(`\n ${name}[`);
  if (start === -1) start = text.indexOf(`\n ${name}:`);
  if (start === -1) return [];
  const from = text.indexOf('\n', start + 1);
  const rest = text.slice(from + 1);
  const next = /\n [A-Z][A-Z\d_.]*[[:=]/.exec(rest);
  const tokens = [];
  for (const line of rest.slice(0, next?.index ?? rest.length).split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    tokens.push(...trimmed.split(/\s+/));
  }
  return tokens;
}

/**
 * Write one fixture.
 * @param {string} name - Its file name under the test data directory.
 * @param {object} value - Its contents.
 */
function writeJson(name, value) {
  writeFileSync(join(DATA, name), `${JSON.stringify(value, null, 1)}\n`);
  console.log(`wrote src/basis/__tests__/data/${name}`);
}
