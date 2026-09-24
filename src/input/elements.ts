import type { Mopac7Method } from '../types.ts';

/**
 * The elements each hamiltonian in this build is parameterised for, as element
 * symbols in ascending atomic number.
 *
 * MOPAC decides this itself: `refer.f` refuses an element whose reference
 * string in `block.f` does not start with a blank, and the four tables below
 * are the blank-prefixed entries of `REFMN`, `REFM3`, `REFAM` and `REFPM3`
 * read out of the very `block.f` this module was built from.
 *
 * Two families of entry are deliberately left out. `Cb` (MOPAC's atomic number
 * 102) is the capped bond, not an element; and MOPAC's atomic numbers 90 and 91
 * hold alternative Si and S parameter sets rather than thorium and
 * protactinium, so accepting `'Th'` would quietly run silicon.
 *
 * `Na` and `K` are parameterised in AM1 and PM3 only as sparkles — MOPAC's own
 * reference line for them reads "SODIUM-LIKE SPARKLE. USE WITH CARE".
 */
export const MOPAC7_ELEMENTS: Record<Mopac7Method, readonly string[]> = {
  MNDO: [
    'H',
    'Li',
    'Be',
    'B',
    'C',
    'N',
    'O',
    'F',
    'Na',
    'Al',
    'Si',
    'P',
    'S',
    'Cl',
    'K',
    'Cr',
    'Zn',
    'Ge',
    'Br',
    'Sn',
    'I',
    'Hg',
    'Pb',
  ],
  MINDO3: ['H', 'B', 'C', 'N', 'O', 'F', 'Si', 'P', 'S', 'Cl'],
  AM1: [
    'H',
    'Li',
    'Be',
    'B',
    'C',
    'N',
    'O',
    'F',
    'Na',
    'Al',
    'Si',
    'P',
    'S',
    'Cl',
    'K',
    'Zn',
    'Ge',
    'Br',
    'I',
    'Hg',
  ],
  PM3: [
    'H',
    'Be',
    'C',
    'N',
    'O',
    'F',
    'Na',
    'Mg',
    'Al',
    'Si',
    'P',
    'S',
    'Cl',
    'K',
    'Zn',
    'Ga',
    'Ge',
    'As',
    'Se',
    'Br',
    'Cd',
    'In',
    'Sn',
    'Sb',
    'Te',
    'I',
    'Hg',
    'Tl',
    'Pb',
    'Bi',
  ],
};

/**
 * Resolve an element symbol the way MOPAC's `getgeo.f` does: case-insensitively,
 * against its own table of the first 98 elements.
 * @param symbol - An element symbol such as `'C'`, `'cl'` or `'Br'`.
 * @returns The atomic number, or `null` when MOPAC has no such symbol.
 */
export function elementNumber(symbol: string): number | null {
  return NUMBER_BY_SYMBOL.get(symbol.trim().toUpperCase()) ?? null;
}

/**
 * Whether this hamiltonian carries parameters for an element.
 * @param symbol - An element symbol.
 * @param method - The hamiltonian.
 * @returns `true` when MOPAC would accept the element under that method.
 */
export function isElementSupported(
  symbol: string,
  method: Mopac7Method,
): boolean {
  return SUPPORTED_BY_METHOD[method].has(symbol.trim().toUpperCase());
}

/**
 * Whether an atom is hydrogen, which MOPAC counts against a separate limit from
 * every other element (`MAXLIT` against `MAXHEV` in its `SIZES` file).
 * @param symbol - An element symbol.
 * @returns `true` for hydrogen.
 */
export function isHydrogen(symbol: string): boolean {
  return elementNumber(symbol) === 1;
}

/**
 * MOPAC's own element table, read from the `ELEMNT` data statement of
 * `block.f`. The index is the atomic number minus one, so `SYMBOLS[5]` is
 * carbon. MOPAC's entries above 98 are dummy atoms, sparkles and capped bonds
 * rather than elements, and are not listed.
 */
const SYMBOLS = (
  'H He Li Be B C N O F Ne Na Mg Al Si ' +
  'P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni ' +
  'Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo ' +
  'Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba ' +
  'La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb ' +
  'Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po ' +
  'At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf'
).split(' ');

const NUMBER_BY_SYMBOL = new Map<string, number>();
for (let index = 0; index < SYMBOLS.length; index++) {
  NUMBER_BY_SYMBOL.set((SYMBOLS[index] as string).toUpperCase(), index + 1);
}

const SUPPORTED_BY_METHOD: Record<Mopac7Method, ReadonlySet<string>> = {
  MNDO: upperCaseSet(MOPAC7_ELEMENTS.MNDO),
  MINDO3: upperCaseSet(MOPAC7_ELEMENTS.MINDO3),
  AM1: upperCaseSet(MOPAC7_ELEMENTS.AM1),
  PM3: upperCaseSet(MOPAC7_ELEMENTS.PM3),
};

function upperCaseSet(symbols: readonly string[]): ReadonlySet<string> {
  const set = new Set<string>();
  for (const symbol of symbols) set.add(symbol.toUpperCase());
  return set;
}
