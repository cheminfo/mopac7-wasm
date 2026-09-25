import { Mopac7Error } from '../Mopac7Error.ts';
import type { Mopac7Method, Mopac7Result } from '../types.ts';

import { findHaltReason, listingTail } from './haltReason.ts';
import { parseAtoms } from './parseAtoms.ts';
import { parseEigenvectors } from './parseEigenvectors.ts';

/**
 * Read a MOPAC 7 listing into a typed result. No WebAssembly is involved, so
 * this also parses the output of a native MOPAC 7 run.
 *
 * MOPAC 7 has no machine-readable output file — no `.aux`, no `.json` — so
 * every number here comes from fixed-width Fortran, and every block is checked
 * rather than assumed: a missing heading, a root numbering that does not start
 * at 1, a charge block that skips an atom, a coefficient row of the wrong
 * width, and an eigenvector matrix that is not square or does not reach the
 * last atom all throw instead of yielding a plausible wrong number.
 *
 * When MOPAC stopped instead of finishing, the error carries the reason MOPAC
 * printed — it exits 0 at all 114 of its `STOP` statements, so the listing is
 * the only place a reason exists. See `src/output/haltReason.ts`.
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

  assertNoFailure(text, lines);
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
  assertBasisCoversEveryAtom(basis, atoms.elements.length);

  return {
    version,
    method: readMethod(text, listing),
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
 * Read the hamiltonian off MOPAC's own heading. `readmo.f` lines 229 to 234 pick
 * one of `   MNDO`, `MINDO/3`, `    AM1` and `    PM3` — MNDO when the deck names
 * none — and print it ahead of ` CALCULATION RESULTS`, so this is MOPAC's own
 * decision rather than a second reading of the keyword line.
 * @param text - The listing with the `symtrz.f` noise dropped.
 * @param listing - The listing verbatim, for the error.
 * @returns The hamiltonian.
 * @throws {Mopac7Error} With `code: 'parse'` when the heading is absent.
 */
function readMethod(text: string, listing: string): Mopac7Method {
  const heading = capture(
    text,
    /^\s*(?<value>MNDO|MINDO\/3|AM1|PM3) CALCULATION RESULTS\s*$/m,
  );
  if (heading === null) {
    throw new Mopac7Error(
      'parse',
      'the listing carries no "<hamiltonian> CALCULATION RESULTS" heading',
      { output: listing },
    );
  }
  return heading === 'MINDO/3' ? 'MINDO3' : (heading as Mopac7Method);
}

function assertNoFailure(text: string, lines: readonly string[]): void {
  const halt = findHaltReason(lines);
  if (halt !== null) {
    throw new Mopac7Error(halt.code, `MOPAC stopped: ${halt.reason}`, {
      output: text,
    });
  }
  if (!text.includes('SCF FIELD WAS ACHIEVED')) {
    throw new Mopac7Error(
      'halt',
      `MOPAC stopped before it converged a wavefunction, and its last words were: ${listingTail(lines)}`,
      { output: text },
    );
  }
}

/**
 * Every atom MOPAC printed a charge for must carry at least one atomic orbital,
 * and the eigenvector rows are in atom order — so the last row belongs to the
 * last atom. Anything else means rows went missing between the two blocks,
 * which is the shape the >99-atom truncation had: every group stopped at the
 * same row, so the per-orbital width check in `parseEigenvectors` saw nothing
 * wrong and a short `basis` came back with no complaint at all.
 * @param basis - The atomic orbitals, in printed order.
 * @param atomCount - How many atoms the `NET ATOMIC CHARGES` block listed.
 * @throws {Mopac7Error} With `code: 'parse'` when the two blocks disagree.
 */
function assertBasisCoversEveryAtom(
  basis: ReadonlyArray<{ atomIndex: number }>,
  atomCount: number,
): void {
  if (basis.length === 0) return;
  const highest = (basis.at(-1) as { atomIndex: number }).atomIndex + 1;
  if (highest === atomCount) return;
  throw new Mopac7Error(
    'parse',
    `the eigenvectors reach atom ${highest} but the charge block lists ${atomCount} atoms, ` +
      `so ${highest > atomCount ? 'the two blocks disagree' : `the rows of atoms ${highest + 1} to ${atomCount} were not read`}`,
  );
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

// With DEBUG on the deck, wrtkey.f lists the keywords it did not recognise
// instead of stopping on them. The decks this package builds do not carry
// DEBUG, so this is empty unless the caller asked for it.
function readUnknownKeywords(text: string): string[] {
  const line = capture(text, /DEBUG KEYWORDS USED:\s*(?<value>.*)/);
  if (line === null) return [];
  const unknown: string[] = [];
  for (const word of line.trim().split(/\s+/)) {
    if (word.length > 0) unknown.push(word);
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
