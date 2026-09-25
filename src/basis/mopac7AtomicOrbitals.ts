import { Mopac7Error } from '../Mopac7Error.ts';
import { isElementSupported } from '../input/elements.ts';
import type { Mopac7AtomicOrbital, Mopac7Method } from '../types.ts';

import { MOPAC7_SLATER_EXPONENTS } from './slaterExponents.ts';
import type { Mopac7ElementBasis } from './types.ts';

/**
 * The atomic orbitals MOPAC 7 gives a molecule, in MOPAC's own order — which is
 * the row order of `Mopac7Result.coefficients`.
 *
 * MOPAC lays the basis out atom by atom and, within an atom, `S Px Py Pz`
 * (`matou1.f` `ATORBS`), taking the count from `block.f`'s `NATORB`: one orbital
 * for hydrogen, four for every other element these four hamiltonians are
 * parameterised for, and **none** for the sodium and potassium sparkles, which
 * carry a core charge and no basis function at all.
 *
 * A result always carries this list already, so the reason to call this is to
 * build a basis before running anything — the two agree exactly, which
 * `__tests__/mopac7Basis.test.ts` asserts against real listings.
 * @param elements - Element symbols, one per atom, in MOPAC's atom order.
 * @param method - The hamiltonian.
 * @returns One entry per atomic orbital.
 * @throws {Mopac7Error} With `code: 'input'` for an element the hamiltonian cannot expand.
 */
export function mopac7AtomicOrbitals(
  elements: readonly string[],
  method: Mopac7Method,
): Mopac7AtomicOrbital[] {
  const orbitals: Mopac7AtomicOrbital[] = [];
  for (let atomIndex = 0; atomIndex < elements.length; atomIndex++) {
    const element = elements[atomIndex] as string;
    const entry = slaterEntry(element, method);
    if (entry === null) continue;
    const types = ORBITAL_TYPES[entry.orbitalCount];
    if (types === undefined) cannotExpand(entry, element, method);
    for (const type of types) orbitals.push({ atomIndex, element, type });
  }
  return orbitals;
}

/**
 * Look one element's valence shells up in a hamiltonian's exponent table.
 * @param symbol - The element symbol, in any case.
 * @param method - The hamiltonian.
 * @returns The entry, or `null` when MOPAC gives the element no atomic orbital.
 * @throws {Mopac7Error} With `code: 'input'` when the hamiltonian has no such element.
 */
export function slaterEntry(
  symbol: string,
  method: Mopac7Method,
): Mopac7ElementBasis | null {
  const table = MOPAC7_SLATER_EXPONENTS[method];
  const entry = table[symbol] ?? table[canonical(symbol)];
  if (entry !== undefined) return entry;
  // The hamiltonian knows the element but `block.f` gives it no exponent: it is
  // one of MOPAC's sparkles, a core charge with an empty basis.
  if (isElementSupported(symbol, method)) return null;
  throw new Mopac7Error(
    'input',
    `${method} has no Slater exponents for ${symbol}; it can expand ${Object.keys(table).join(' ')}`,
  );
}

/** `matou1.f` `ATORBS`, indexed by `NATORB`. */
const ORBITAL_TYPES: Record<number, readonly string[] | undefined> = {
  1: ['S'],
  4: ['S', 'Px', 'Py', 'Pz'],
};

/**
 * Spell an element symbol the way MOPAC's own table does: `NA` and `na` both
 * become `Na`.
 * @param symbol - The symbol, in any case.
 * @returns It with one leading capital.
 */
function canonical(symbol: string): string {
  const trimmed = symbol.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

/**
 * Fail on an element whose shells MOPAC's own STO-6G table cannot hold.
 * @param entry - Its table entry.
 * @param symbol - Its symbol.
 * @param method - The hamiltonian.
 * @throws {Mopac7Error} Always, with `code: 'input'`.
 */
function cannotExpand(
  entry: Mopac7ElementBasis,
  symbol: string,
  method: Mopac7Method,
): never {
  throw new Mopac7Error(
    'input',
    `${method} gives ${symbol} ${entry.orbitalCount} atomic orbitals, so it carries a d shell, and MOPAC 7's own STO-6G table (setupg.f) expands only s and p: this element has orbital energies and coefficients but no drawable basis`,
  );
}
