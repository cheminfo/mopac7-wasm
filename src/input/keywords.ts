import { Mopac7Error } from '../Mopac7Error.ts';
import type { Mopac7AmideCorrection, Mopac7Spin } from '../types.ts';

/**
 * Check one caller-supplied MOPAC keyword before it is appended to the first
 * line of the deck.
 *
 * A MOPAC deck is positional — keywords, title, comment, then the geometry —
 * and `gettxt.f` decides how many of those lines it reads from the keyword line
 * itself, so a keyword is not inert text. Three ways a keyword would corrupt the
 * deck or the result, all refused here:
 *
 * whitespace, and a newline above all, because it would end the keyword line
 *   early and shift every line below it: `'FOO\nBAR'` makes `BAR` the title and
 *   the title the comment, and MOPAC then reads the geometry one line late;
 * `+`, which is MOPAC's own continuation marker: ` +` on the keyword line makes
 *   `gettxt.f` read the title line as a second line of keywords;
 * `SETUP`, which makes `gettxt.f` open and read a file named by the deck.
 *
 * `UHF` is refused for a different reason: the run succeeds, but its listing
 * carries separate alpha and beta eigenvector blocks and no
 * `NO. OF FILLED LEVELS`, which is not a shape `Mopac7Result` has. A
 * multiplicity alone (`spin`) is supported and runs MOPAC's RHF half-electron
 * treatment.
 *
 * `MMOK` and `NOMM` are refused too, and for a third reason: the deck always
 * carries exactly one of them (see {@link AMIDE_KEYWORDS}), so a second one
 * here would put both on the line, where `moldat.f` silently prefers `MMOK`
 * whatever the order. They are set through `options.amideCorrection`.
 * @param keyword - The keyword as the caller wrote it.
 * @returns The same keyword.
 * @throws {Mopac7Error} With `code: 'input'` when the keyword cannot go on the deck.
 */
export function checkExtraKeyword(keyword: string): string {
  if (keyword.length === 0) {
    throw new Mopac7Error('input', 'a keyword in options.keywords is empty');
  }
  if (!PRINTABLE_WORD.test(keyword)) {
    throw new Mopac7Error(
      'input',
      `the keyword ${JSON.stringify(keyword)} holds whitespace or a character MOPAC cannot read; ` +
        'pass one keyword per array entry, using only printable ASCII',
    );
  }
  if (keyword.includes('+')) {
    throw new Mopac7Error(
      'input',
      `the keyword ${JSON.stringify(keyword)} holds "+", which is MOPAC's marker for a second keyword line; ` +
        'it would make MOPAC read the title as more keywords',
    );
  }
  const upper = keyword.toUpperCase();
  if (upper.includes('SETUP')) {
    throw new Mopac7Error(
      'input',
      `the keyword ${JSON.stringify(keyword)} makes MOPAC read keywords from a file; ` +
        'pass them in options.keywords instead',
    );
  }
  // MOPAC tests for it with INDEX(KEYWRD,'UHF'), so any keyword holding those
  // three letters switches the unrestricted path on.
  if (upper.includes('UHF')) {
    throw new Mopac7Error(
      'input',
      'UHF is not supported: its listing carries separate alpha and beta eigenvectors, which this result type ' +
        "has no shape for. Use the spin option on its own for MOPAC's RHF half-electron open-shell treatment",
    );
  }
  if (upper.includes('MMOK') || upper.includes('NOMM')) {
    throw new Mopac7Error(
      'input',
      `${JSON.stringify(keyword)} is set through the amideCorrection option, not options.keywords: ` +
        'every deck already carries one of MMOK and NOMM, and MOPAC takes MMOK when it sees both. ' +
        "Pass amideCorrection: 'mmok' or 'nomm'",
    );
  }
  return keyword;
}

/**
 * MOPAC reads keywords from the first line of the deck, which its `gettxt.f`
 * holds in an 80-character buffer. Two further lines are available through `+`,
 * but this package never needs them and {@link checkExtraKeyword} refuses one.
 */
export const MAX_KEYWORD_LINE = 80;

/**
 * MOPAC's two peptide keywords, one of which is on every deck this package
 * builds.
 *
 * `moldat.f` looks for an `H-N-C=O` group in the geometry and, on finding one,
 * prints
 *
 *     THIS SYSTEM CONTAINS -HNCO- GROUPS.
 *     YOU MUST SPECIFY "NOMM" OR "MMOK" REGARDING MOLECULAR MECHANICS CORRECTION
 *
 * and stops. It tests `MMOK` first, so a deck carrying both gets `MMOK` —
 * which is why {@link checkExtraKeyword} refuses either in the caller's extra
 * keywords rather than letting a second one onto the line.
 */
export const AMIDE_KEYWORDS: Record<Mopac7AmideCorrection, string> = {
  mmok: 'MMOK',
  nomm: 'NOMM',
};

/** The keyword MOPAC's own multiplicity is written as, or `null` for a closed shell. */
export const SPIN_KEYWORDS: Record<Mopac7Spin, string | null> = {
  singlet: null,
  doublet: 'DOUBLET',
  triplet: 'TRIPLET',
  quartet: 'QUARTET',
  quintet: 'QUINTET',
  sextet: 'SEXTET',
};

/** One run of printable ASCII, space and every control character excluded. */
const PRINTABLE_WORD = /^[!-~]+$/;
