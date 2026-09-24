import type { Mopac7ErrorCode } from '../types.ts';

/** Why MOPAC stopped, in MOPAC's own words, with a code to switch on. */
export interface Mopac7Halt {
  /** The code the thrown error carries. */
  code: Mopac7ErrorCode;
  /** The lines MOPAC printed about it, trimmed and joined with ` / `. */
  reason: string;
}

/**
 * Read out of a listing why MOPAC 7 stopped.
 *
 * MOPAC 7 has 114 `STOP` statements and exits 0 at every one of them, so the
 * exit code says nothing and the listing says everything: the last thing MOPAC
 * printed before it stopped *is* the reason. This reads that, rather than
 * inferring a cause from a block that is missing.
 *
 * Two passes. {@link MOPAC7_HALTS} recognises the halts worth a code of their
 * own — MOPAC's own wording, taken from the Fortran and never paraphrased. When
 * none matches, the tail of the listing is quoted verbatim under
 * `code: 'halt'`, which is what keeps a halt nobody anticipated from being
 * reported as something else.
 * @param lines - The listing, split into lines, `symtrz.f`'s debug noise already dropped.
 * @returns The halt, or `null` when MOPAC printed none of these.
 */
export function findHaltReason(lines: readonly string[]): Mopac7Halt | null {
  for (const halt of MOPAC7_HALTS) {
    const index = findLine(lines, halt.needle);
    if (index === -1) continue;
    return { code: halt.code, reason: quoteFrom(lines, index) };
  }
  return null;
}

/**
 * What MOPAC last said, for a halt {@link MOPAC7_HALTS} does not name.
 * @param lines - The listing, split into lines.
 * @returns Up to {@link TAIL_LINES} trimmed lines, joined with ` / `, or `''` when the listing is blank.
 */
export function listingTail(lines: readonly string[]): string {
  const tail: string[] = [];
  for (
    let index = lines.length - 1;
    index >= 0 && tail.length < TAIL_LINES;
    index--
  ) {
    const line = (lines[index] as string).trim();
    if (line.length > 0) tail.unshift(line);
  }
  return tail.join(' / ');
}

/**
 * The halts a caller can act on, with MOPAC's own wording. Every needle below
 * is a string MOPAC 7 prints immediately before a `STOP`, so none of them can
 * appear in a listing that ran to the end; the order is most specific first.
 */
const MOPAC7_HALTS: ReadonlyArray<{ code: Mopac7ErrorCode; needle: string }> = [
  // wrtkey.f, moldat.f: the keyword line.
  { code: 'keywords', needle: 'UNRECOGNIZED KEY-WORDS' },
  { code: 'keywords', needle: 'THIS SYSTEM CONTAINS -HNCO- GROUPS' },
  { code: 'keywords', needle: 'OF KEYWORDS DOES NOT HAVE ENOUGH' },
  { code: 'keywords', needle: 'ONLY ONE OF MINDO, MNDO, AM1 AND PM3 ALLOWED' },
  { code: 'keywords', needle: 'MORE THAN ONE GEOMETRY OPTION HAS BEEN' },
  { code: 'keywords', needle: 'MULLIKEN POPULATION NOT AVAILABLE WITH UHF' },
  { code: 'keywords', needle: 'C.I. NOT ALLOWED WITH UHF' },
  // refer.f, moldat.f: the hamiltonian and its parameters.
  { code: 'parameters', needle: 'DATA ARE NOT AVAILABLE FOR ELEMENT NO.' },
  { code: 'parameters', needle: 'NO PARAMETERS ARE AVAILABLE' },
  { code: 'parameters', needle: 'SPECIFY "PARASOK" IN THE KEYWORDS' },
  { code: 'parameters', needle: 'THE HAMILTONIAN REQUESTED IS NOT AVAILABLE' },
  // getgeo.f, gmetry.f, readmo.f, update.f: the geometry.
  { code: 'geometry', needle: 'GEOMETRY IS FAULTY' },
  { code: 'geometry', needle: 'MUST NOT LIE IN A STRAIGHT LINE' },
  { code: 'geometry', needle: 'ANGSTROMS OF A STRAIGHT LINE' },
  { code: 'geometry', needle: 'ILLEGAL ATOMIC NUMBER' },
  { code: 'geometry', needle: 'TO CONTINUE CALCULATION SPECIFY "GEO-OK"' },
  { code: 'geometry', needle: 'ARE COINCIDENT' },
  { code: 'geometry', needle: 'IS ILL-DEFINED' },
  { code: 'geometry', needle: 'ERROR DURING READ AT ATOM NUMBER' },
  { code: 'geometry', needle: 'UNACCEPTABLE VALUE FOR NO. OF ORBITALS' },
  // getgeo.f, moldat.f: the bounds SIZES was compiled with.
  { code: 'limits', needle: 'MAX. NUMBER OF ATOMS ALLOWED' },
  { code: 'limits', needle: 'MAXIMUM NUMBER OF ATOMIC ORBITALS EXCEEDED' },
  { code: 'limits', needle: 'MAX. NUMBER OF ORBITALS' },
  { code: 'limits', needle: 'MAX. NUMBER OF TWO-ELECTRON INTEGRALS' },
  // iter.f, writmo.f: the SCF.
  { code: 'scf', needle: 'FAILED TO ACHIEVE SCF' },
  { code: 'scf', needle: 'FOR SOME REASON THE SCF CALCULATION FAILED' },
];

/** How many trailing lines of a listing {@link listingTail} quotes. */
const TAIL_LINES = 3;

/** How many lines of a halt message {@link quoteFrom} keeps after the first. */
const HALT_CONTINUATION_LINES = 2;

// A MOPAC halt is often two or three consecutive lines -- the complaint, then
// what to do about it -- so quoting only the matched line drops the half a
// caller needs.
function quoteFrom(lines: readonly string[], index: number): string {
  const quoted = [(lines[index] as string).trim()];
  for (
    let below = index + 1;
    below < lines.length && quoted.length <= HALT_CONTINUATION_LINES;
    below++
  ) {
    const line = (lines[below] as string).trim();
    if (line.length === 0) break;
    quoted.push(line);
  }
  return quoted.join(' / ');
}

function findLine(lines: readonly string[], needle: string): number {
  for (let index = 0; index < lines.length; index++) {
    if ((lines[index] as string).includes(needle)) return index;
  }
  return -1;
}
