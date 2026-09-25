import type { Mopac7Method } from '../../types.ts';

/** One Stewart STO-6G expansion, exactly as `setupg.f` writes it. */
export interface FortranShellExpansion {
  /** `ALLZ(j, n, l + 1)`: the gaussian exponents before the `zeta²` scaling. */
  alpha: number[];
  /** `ALLC(j, n, l + 1)`: the contraction coefficients before normalisation. */
  coefficient: number[];
}

/** The valence Slater exponents of one element under one hamiltonian. */
export interface FortranExponents {
  /** `ZS`: the valence s exponent. */
  s: number;
  /** `ZP`: the valence p exponent, or `null` when the array holds none. */
  p: number | null;
}

/** Everything the basis tables need, read out of MOPAC 7's Fortran. */
export interface FortranBasisTables {
  /** Per hamiltonian, the valence exponents keyed by atomic number. */
  exponents: Record<Mopac7Method, Map<number, FortranExponents>>;
  /** `diat.f` `NPQ`: the principal quantum number, indexed by atomic number − 1. */
  principalQuantumNumber: number[];
  /** `block.f` `NATORB`: atomic orbitals per atom, indexed by atomic number − 1. */
  orbitalCount: number[];
  /** `setupg.f` STO-6G, indexed `[n - 1][l]`; `null` where MOPAC has no entry. */
  sto6g: Array<Array<FortranShellExpansion | null>>;
}

/**
 * Read MOPAC 7's own basis-set tables out of MOPAC 7's own fixed-form Fortran.
 *
 * Everything is parsed, nothing is transcribed. The text may be one source file,
 * several concatenated, or the excerpt under `data/`: the arrays are looked up by
 * name, and the names are unique across the four files this needs.
 *
 * Which array belongs to which hamiltonian is `moldat.f`'s own decision:
 * `ZS(I)=ZSM(I)` for MNDO (line 93), `ZS(I)=ZSPM3(I)` for PM3 (line 125),
 * `ZS(I)=ZSAM1(I)` for AM1 (line 157), and `ZS(I)=ZS3(I)` for MINDO/3, which
 * overwrites the MNDO values for atomic numbers 1 to 17 (line 230).
 * @param text - Fixed-form Fortran. Column-1 `C`, `c` and `*` lines are comments.
 * @returns The parsed tables.
 * @throws {Error} When an array this needs is absent or malformed.
 */
export function parseBasisFortran(text: string): FortranBasisTables {
  const lines = activeLines(text);
  return {
    exponents: {
      MNDO: readIndexedArray(lines, 'ZSM', 'ZPM'),
      MINDO3: readPairedArray(lines, 'ZS3', 'ZP3'),
      AM1: readIndexedArray(lines, 'ZSAM1', 'ZPAM1'),
      PM3: readIndexedArray(lines, 'ZSPM3', 'ZPPM3'),
    },
    principalQuantumNumber: readRepeatedList(lines, 'NPQ'),
    orbitalCount: readRepeatedList(lines, 'NATORB'),
    sto6g: readStoTable(lines),
  };
}

const NUMBER = String.raw`[-+]?\d*\.?\d+(?:[dDeE][-+]?\d+)?`;

/**
 * Drop the comment lines, keeping every other line at its own index so a
 * fixed-form continuation still follows the statement it continues.
 * @param text - Fixed-form Fortran.
 * @returns One entry per line, comments replaced by an empty string.
 */
function activeLines(text: string): string[] {
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    kept.push(/^[*cC!]/.test(line) ? '' : line);
  }
  return kept;
}

/**
 * Remove every blank. Fortran ignores blanks inside an identifier, so
 * `ZS AM1( 6)` is `ZSAM1(6)`.
 * @param line - One line of fixed-form Fortran.
 * @returns It with no blanks left.
 */
function squeeze(line: string): string {
  return line.replaceAll(' ', '');
}

/**
 * Read `DATA <s>(<z>)/ <value>/` statements for a pair of arrays.
 * @param lines - From {@link activeLines}.
 * @param sName - The s-exponent array, e.g. `ZSM`.
 * @param pName - The p-exponent array, e.g. `ZPM`.
 * @returns The exponents keyed by atomic number.
 */
function readIndexedArray(
  lines: readonly string[],
  sName: string,
  pName: string,
): Map<number, FortranExponents> {
  const s = readSingleValues(lines, sName);
  const p = readSingleValues(lines, pName);
  if (s.size === 0) throw new Error(`no DATA ${sName} statements`);
  const found = new Map<number, FortranExponents>();
  for (const [atomicNumber, value] of s) {
    found.set(atomicNumber, { s: value, p: p.get(atomicNumber) ?? null });
  }
  return found;
}

/**
 * Read every `DATA <name>(<index>)/ <value>/` statement of one array.
 * @param lines - From {@link activeLines}.
 * @param name - The array name, blanks removed.
 * @returns The values keyed by index.
 */
function readSingleValues(
  lines: readonly string[],
  name: string,
): Map<number, number> {
  const pattern = new RegExp(
    String.raw`^DATA${name}\((\d+)\)/(${NUMBER})/$`,
    'i',
  );
  const found = new Map<number, number>();
  for (const line of lines) {
    const match = pattern.exec(squeeze(line));
    if (match !== null) found.set(Number(match[1]), fortranNumber(match[2]));
  }
  return found;
}

/**
 * Read MINDO/3's paired form, `DATA ZS3(<z>),ZP3(<z>)/ <zs>, <zp>/`. A zero `ZP3`
 * is MOPAC's way of saying the element has no p shell, so it reads as `null`.
 * @param lines - From {@link activeLines}.
 * @param sName - The s-exponent array.
 * @param pName - The p-exponent array.
 * @returns The exponents keyed by atomic number.
 */
function readPairedArray(
  lines: readonly string[],
  sName: string,
  pName: string,
): Map<number, FortranExponents> {
  const pattern = new RegExp(
    String.raw`^DATA${sName}\((\d+)\),${pName}\((\d+)\)/(${NUMBER}),(${NUMBER})/$`,
    'i',
  );
  const found = new Map<number, FortranExponents>();
  for (const line of lines) {
    const match = pattern.exec(squeeze(line));
    if (match === null) continue;
    if (match[1] !== match[2]) {
      throw new Error(`DATA ${sName}/${pName} indices disagree: ${line}`);
    }
    const p = fortranNumber(match[4]);
    found.set(Number(match[1]), { s: fortranNumber(match[3]), p: p || null });
  }
  if (found.size === 0) throw new Error(`no DATA ${sName},${pName} statements`);
  return found;
}

/**
 * Read a whole-array `DATA <name>/ … /`, expanding Fortran's `<count>*<value>`
 * repeat form and following every continuation line — one whose column 6 is not
 * blank — until the closing slash.
 * @param lines - From {@link activeLines}.
 * @param name - The array name.
 * @returns The expanded values, in declaration order.
 */
function readRepeatedList(lines: readonly string[], name: string): number[] {
  const head = `DATA${name.toUpperCase()}/`;
  let body: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    const squeezed = squeeze(lines[index] as string).toUpperCase();
    if (!squeezed.startsWith(head)) continue;
    body = squeezed.slice(head.length);
    for (let next = index + 1; !body.includes('/'); next++) {
      const more = lines[next];
      if (more === undefined || more.length < 6 || more[5] === ' ') break;
      body += squeeze(more.slice(6));
    }
    break;
  }
  if (body === null) throw new Error(`no DATA ${name}/ statement`);
  const values: number[] = [];
  for (const token of body.slice(0, body.indexOf('/')).split(',')) {
    const repeat = /^(?<count>\d+)\*(?<value>-?\d+)$/.exec(token);
    if (repeat?.groups === undefined) {
      if (token !== '') values.push(Number(token));
      continue;
    }
    const { count, value } = repeat.groups;
    for (let i = 0; i < Number(count); i++) values.push(Number(value));
  }
  return values;
}

/**
 * Read `SETUPG`'s `ALLZ(j, n, l) = <value>` / `ALLC(…)` assignments. Its
 * `COMMON /STO6G/` is declared `(6,5,2)`, so the 6s and 6p blocks it assigns are
 * past the end of MOPAC's own array; read from the source they are as usable as
 * the other five rows.
 * @param lines - From {@link activeLines}.
 * @returns The table, indexed `[n - 1][l]`.
 */
function readStoTable(
  lines: readonly string[],
): Array<Array<FortranShellExpansion | null>> {
  const pattern = new RegExp(
    String.raw`^ALL([ZC])\((\d+),(\d+),(\d+)\)=(${NUMBER})$`,
    'i',
  );
  const table: Array<Array<FortranShellExpansion | null>> = [];
  for (const line of lines) {
    const match = pattern.exec(squeeze(line));
    if (match === null) continue;
    const primitive = Number(match[2]) - 1;
    const n = Number(match[3]) - 1;
    const l = Number(match[4]) - 1;
    table[n] ??= [];
    const row = table[n];
    row[l] ??= { alpha: [], coefficient: [] };
    const shell = row[l];
    const target =
      match[1]?.toUpperCase() === 'Z' ? shell.alpha : shell.coefficient;
    target[primitive] = fortranNumber(match[5]);
  }
  if (table.length === 0) throw new Error('no ALLZ/ALLC assignments');
  for (let n = 0; n < table.length; n++) {
    const row = table[n];
    if (row === undefined) {
      table[n] = [];
      continue;
    }
    for (let l = 0; l < row.length; l++) row[l] ??= null;
  }
  return table;
}

/**
 * Turn one Fortran double literal into a number. `1.3319670D0` is not valid
 * JavaScript, so the exponent marker is normalised.
 * @param literal - The matched literal.
 * @returns Its value.
 */
function fortranNumber(literal: string | undefined): number {
  const value = Number(String(literal).replace(/[dD]/, 'e'));
  if (!Number.isFinite(value)) throw new Error(`not a number: ${literal}`);
  return value;
}
