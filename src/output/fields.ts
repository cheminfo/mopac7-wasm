import { Mopac7Error } from '../Mopac7Error.ts';

/**
 * Where MOPAC's eigenvector block puts its numbers: eight columns of eight
 * characters starting at column 10, on the eigenvalue row and on every
 * coefficient row alike.
 */
export const FIELD_START = 10;

/** The width of one printed column in that block. */
export const FIELD_WIDTH = 8;

/**
 * Read `count` numbers out of one row of MOPAC's fixed-width output.
 * @param line - The row, verbatim.
 * @param count - How many numbers the row must hold.
 * @returns The numbers, in printed order.
 * @throws {Mopac7Error} With `code: 'parse'` when the row does not read as that many numbers.
 */
export function readNumbers(line: string, count: number): number[] {
  const values = tryNumbers(line, count);
  if (values === null) {
    throw new Mopac7Error(
      'parse',
      `expected ${count} numbers, found "${line.trim()}"`,
    );
  }
  return values;
}

/**
 * The same read, answering `null` instead of throwing, which is how a row is
 * recognised in the first place.
 * @param line - The row, verbatim.
 * @param count - How many numbers the row must hold.
 * @returns The numbers, or `null` when the row is something else.
 */
export function tryNumbers(line: string, count: number): number[] | null {
  const fixed: number[] = [];
  for (let k = 0; k < count; k++) {
    const field = line
      .slice(FIELD_START + FIELD_WIDTH * k, FIELD_START + FIELD_WIDTH * (k + 1))
      .trim();
    const value = Number(field);
    if (field.length === 0 || !Number.isFinite(value)) {
      fixed.length = 0;
      break;
    }
    fixed.push(value);
  }
  if (fixed.length === count) return fixed;

  // Fall back to splitting the value part on whitespace, which is right
  // whenever two fields did not run into each other. Fortran's F8.3 leaves no
  // separator below -100 eV, which is why the fixed-width read comes first.
  const rest = line.slice(FIELD_START).trim();
  // Without this, `''.split(/\s+/)` is one empty token and `Number('')` is 0, so
  // a blank line would read as the single number 0 — which is exactly the line
  // above the eigenvalues in a root group of one.
  if (rest.length === 0) return null;
  const tokens = rest.split(/\s+/);
  if (tokens.length !== count) return null;
  const loose: number[] = [];
  for (const token of tokens) {
    const value = Number(token);
    if (!Number.isFinite(value)) return null;
    loose.push(value);
  }
  return loose;
}
