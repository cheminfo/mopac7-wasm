import { Mopac7Error } from '../Mopac7Error.ts';
import type { Mopac7Result } from '../types.ts';

import { parseAtoms } from './parseAtoms.ts';
import { parseEigenvectors } from './parseEigenvectors.ts';

/**
 * Read a MOPAC 7 listing into a typed result. No WebAssembly is involved, so
 * this also parses the output of a native MOPAC 7 run.
 *
 * MOPAC 7 has no machine-readable output file — no `.aux`, no `.json` — so
 * every number here comes from fixed-width Fortran, and every block is checked
 * rather than assumed: a missing heading, a root numbering that does not start
 * at 1, a charge block that skips an atom and a coefficient row of the wrong
 * width all throw instead of yielding a plausible wrong number.
 *
 * The one number that is not the listing's own is the sign of a molecular
 * orbital coefficient: eigenvector phases are arbitrary and differ between
 * builds, so they are pinned to one convention. See
 * {@link Mopac7Result.coefficients}.
 * @param listing - The listing MOPAC produced, verbatim.
 * @returns Everything the listing carries.
 * @throws {Mopac7Error} With the code that matches MOPAC's own complaint, or `'parse'`.
 */
export function parseMopac7Output(listing: string): Mopac7Result {
  // symtrz.f writes its debug output into the listing; the eval harness this
  // parser was validated against drops the same lines.
  const lines: string[] = [];
  for (const line of listing.split('\n')) {
    if (line.includes('symtrz.f')) continue;
    lines.push(line);
  }
  const text = lines.join('\n');

  assertNoFailure(text);
  const version = capture(text, /MOPAC:\s+VERSION\s+(?<value>[\d.]+)/);
  if (version === null) {
    throw new Mopac7Error(
      'parse',
      'the listing carries no MOPAC version banner',
      {
        output: listing,
      },
    );
  }

  const filledLevels = number(
    text,
    /NO\. OF FILLED LEVELS\s*=\s*(?<value>\d+)/,
    'NO. OF FILLED LEVELS',
  );
  const { orbitals, basis, coefficients } = parseEigenvectors(
    lines,
    filledLevels,
  );
  const atoms = parseAtoms(lines);
  if (basis.length > 0) {
    const highest = basis.at(-1)?.atomIndex ?? -1;
    if (highest >= atoms.elements.length) {
      throw new Mopac7Error(
        'parse',
        `the eigenvectors reach atom ${highest + 1} but only ${atoms.elements.length} atoms were printed`,
      );
    }
  }

  return {
    version,
    converged: text.includes('SCF FIELD WAS ACHIEVED'),
    terminationMessage: findTerminationMessage(lines),
    heatOfFormation: number(
      text,
      /FINAL HEAT OF FORMATION\s*=\s*(?<value>-?\d*\.?\d+)/,
      'FINAL HEAT OF FORMATION',
    ),
    totalEnergy: number(
      text,
      /TOTAL ENERGY\s*=\s*(?<value>-?\d*\.?\d+)/,
      'TOTAL ENERGY',
    ),
    electronicEnergy: number(
      text,
      /ELECTRONIC ENERGY\s*=\s*(?<value>-?\d*\.?\d+)/,
      'ELECTRONIC ENERGY',
    ),
    coreCoreRepulsion: number(
      text,
      /CORE-CORE REPULSION\s*=\s*(?<value>-?\d*\.?\d+)/,
      'CORE-CORE REPULSION',
    ),
    ionizationPotential: number(
      text,
      /IONIZATION POTENTIAL\s*=\s*(?<value>-?\d*\.?\d+)/,
      'IONIZATION POTENTIAL',
    ),
    molecularWeight: number(
      text,
      /MOLECULAR WEIGHT\s*=\s*(?<value>-?\d*\.?\d+)/,
      'MOLECULAR WEIGHT',
    ),
    filledLevels,
    pointGroup: capture(text, /MOLECULAR POINT GROUP\s*:\s*(?<value>\S+)/),
    orbitals,
    basis,
    coefficients,
    charges: atoms.charges,
    electronDensities: atoms.electronDensities,
    dipole: atoms.dipole,
    elements: atoms.elements,
    coordinates: atoms.coordinates,
    computationTimeSeconds: Number(
      capture(text, /COMPUTATION TIME\s*=\s*(?<value>-?\d*\.?\d+)/) ?? '0',
    ),
    unknownKeywords: readUnknownKeywords(text),
  };
}

/**
 * MOPAC's own wording, taken from the Fortran rather than paraphrased:
 * `refer.f` for the parameters, `getgeo.f` and `gmetry.f` for the geometry,
 * `wrtkey.f` for the keywords and `writmo.f` for the SCF.
 */
const FAILURES = [
  { code: 'keywords', needle: 'UNRECOGNIZED KEY-WORDS' },
  { code: 'parameters', needle: 'DATA ARE NOT AVAILABLE FOR ELEMENT NO.' },
  { code: 'geometry', needle: 'GEOMETRY IS FAULTY' },
  { code: 'geometry', needle: 'MUST NOT LIE IN A STRAIGHT LINE' },
  { code: 'geometry', needle: 'ILLEGAL ATOMIC NUMBER' },
  { code: 'scf', needle: 'FAILED TO ACHIEVE SCF' },
] as const;

function assertNoFailure(text: string): void {
  for (const failure of FAILURES) {
    if (!text.includes(failure.needle)) continue;
    throw new Mopac7Error(
      failure.code,
      `MOPAC stopped: ${quoteLine(text, failure.needle)}`,
      {
        output: text,
      },
    );
  }
  if (!text.includes('SCF FIELD WAS ACHIEVED')) {
    throw new Mopac7Error(
      'scf',
      'MOPAC never printed "SCF FIELD WAS ACHIEVED", so there is no converged wavefunction to read',
      { output: text },
    );
  }
}

function quoteLine(text: string, needle: string): string {
  for (const line of text.split('\n')) {
    if (line.includes(needle)) return line.trim();
  }
  return needle;
}

// The FLEPO verdict MOPAC prints on the line above its SCF verdict.
function findTerminationMessage(lines: readonly string[]): string | null {
  for (let index = 0; index < lines.length; index++) {
    if (!(lines[index] as string).includes('SCF FIELD WAS ACHIEVED')) continue;
    for (let above = index - 1; above >= 0 && above > index - 4; above--) {
      const candidate = (lines[above] as string).trim();
      if (candidate.length > 0) return candidate;
    }
    return null;
  }
  return null;
}

// With DEBUG set -- which ALLVEC needs -- MOPAC lists the keywords it did not
// recognise instead of stopping on them, so a typo would otherwise pass
// unnoticed.
function readUnknownKeywords(text: string): string[] {
  const line = capture(text, /DEBUG KEYWORDS USED:\s*(?<value>.*)/);
  if (line === null) return [];
  const words = line.trim().split(/\s+/);
  const unknown: string[] = [];
  for (const word of words) {
    if (word.length > 0 && word !== 'ALLVEC') unknown.push(word);
  }
  return unknown;
}

function capture(text: string, pattern: RegExp): string | null {
  return pattern.exec(text)?.groups?.value ?? null;
}

function number(text: string, pattern: RegExp, heading: string): number {
  const raw = capture(text, pattern);
  if (raw === null) {
    throw new Mopac7Error('parse', `the listing has no "${heading}" line`, {
      output: text,
    });
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Mopac7Error(
      'parse',
      `"${heading}" reads "${raw}", which is not a number`,
      {
        output: text,
      },
    );
  }
  return value;
}
