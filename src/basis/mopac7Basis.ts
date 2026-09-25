import { Mopac7Error } from '../Mopac7Error.ts';

import { contractSlaterShell } from './contractSlaterShell.ts';
import { slaterEntry } from './mopac7AtomicOrbitals.ts';
import type {
  Mopac7Basis,
  Mopac7BasisFunction,
  Mopac7BasisInput,
  Mopac7BasisOptions,
  Mopac7BasisShell,
} from './types.ts';

/**
 * Rebuild the atomic-orbital basis a MOPAC 7 result was computed in, as
 * contracted cartesian gaussians, so its molecular orbitals can be drawn.
 *
 * MOPAC 7 prints orbital energies and coefficients and nothing about the basis
 * they are coefficients over, so the basis is reconstructed from MOPAC's own
 * parameters: the valence Slater exponents of `block.f`, the principal quantum
 * numbers of `diat.f`, and Stewart's STO-6G expansion of `setupg.f`. See
 * `MOPAC7_SLATER_EXPONENTS` and `contractSlaterShell`.
 *
 * The returned `functions` are in the same order as the `basis` handed in, which
 * is the row order of the result's `coefficients`, so
 * `coefficients[mo * functions.length + ao]` is the coefficient of
 * `functions[ao]`. Shells are shared: one entry per element and angular
 * momentum, referenced by `functions[ao].shell`, and one centre per atom rather
 * than per orbital, so the payload stays small — the basis of paclitaxel is 299
 * functions over 7 shells and 113 centres.
 *
 * The coefficients MOPAC prints are **not** coefficients over these orbitals
 * directly. NDDO neglects diatomic overlap, so MOPAC's vectors live in the
 * Löwdin-orthogonalised basis and `Cᵀ S C` is not the identity. See
 * `deorthogonalizeCoefficients`, and the README, for what that costs a
 * drawing (very little) and how MOPAC itself undoes it.
 * @param result - A `Mopac7Result`, or anything carrying its `method`, `elements`, `coordinates` and `basis`.
 * @param options - The ångström-to-bohr divisor.
 * @returns The basis.
 * @throws {Mopac7Error} With `code: 'input'` when an element has no expandable shells, or the input does not add up.
 */
export function mopac7Basis(
  result: Mopac7BasisInput,
  options: Mopac7BasisOptions = {},
): Mopac7Basis {
  const bohrPerAngstrom = options.bohrPerAngstrom ?? MOPAC7_BOHR_PER_ANGSTROM;
  const atomCount = result.elements.length;
  if (result.coordinates.length < atomCount * 3) {
    throw new Mopac7Error(
      'input',
      `${atomCount} elements need ${atomCount * 3} coordinates, and ${result.coordinates.length} were given`,
    );
  }
  const centers = new Float64Array(atomCount * 3);
  for (let index = 0; index < centers.length; index++) {
    centers[index] = (result.coordinates[index] as number) / bohrPerAngstrom;
  }

  const shells: Mopac7BasisShell[] = [];
  const shellByKey = new Map<string, number>();
  const functions: Mopac7BasisFunction[] = [];
  for (const orbital of result.basis) {
    const { atomIndex } = orbital;
    const element = result.elements[atomIndex];
    if (element === undefined) {
      throw new Mopac7Error(
        'input',
        `an atomic orbital sits on atom ${atomIndex + 1}, and only ${atomCount} elements were given`,
      );
    }
    const powers = POWERS[orbital.type];
    if (powers === undefined) {
      throw new Mopac7Error(
        'input',
        `the atomic orbital "${orbital.type}" on ${element} is not an s or p orbital, and MOPAC 7's own STO-6G table (setupg.f) expands only s and p`,
      );
    }
    const l = powers[0] + powers[1] + powers[2];
    const key = `${element}|${l}`;
    let shell = shellByKey.get(key);
    if (shell === undefined) {
      shell = shells.length;
      shells.push(buildShell(element, l, result.method));
      shellByKey.set(key, shell);
    }
    functions.push({ atomIndex, element, type: orbital.type, shell, powers });
  }

  return {
    method: result.method,
    shells,
    functions,
    centers,
    bohrPerAngstrom,
  };
}

/**
 * The ångström-to-bohr divisor MOPAC 7 hard-codes, at `diat.f` line 142 and in
 * six of its other files. It is 19 parts per million below the CODATA value
 * (`0.529177210903`), which is what MOPAC 23 and most other programs use.
 */
export const MOPAC7_BOHR_PER_ANGSTROM = 0.529167;

/** `matou1.f` `ATORBS` mapped to cartesian powers. */
const POWERS: Record<string, readonly [number, number, number] | undefined> = {
  S: [0, 0, 0],
  Px: [1, 0, 0],
  Py: [0, 1, 0],
  Pz: [0, 0, 1],
};

/**
 * Contract one element's shell, with MOPAC's own exponent and principal quantum
 * number.
 * @param element - The element symbol.
 * @param l - `0` for s, `1` for p.
 * @param method - The hamiltonian.
 * @returns The shell.
 * @throws {Mopac7Error} With `code: 'input'` when the element has no such shell.
 */
function buildShell(
  element: string,
  l: number,
  method: Mopac7BasisInput['method'],
): Mopac7BasisShell {
  const entry = slaterEntry(element, method);
  if (entry === null) {
    throw new Mopac7Error(
      'input',
      `${method} gives ${element} no atomic orbital — it is one of MOPAC's sparkles — yet an atomic orbital was listed on it`,
    );
  }
  const zeta = l === 0 ? entry.zetaS : entry.zetaP;
  if (zeta === null) {
    throw new Mopac7Error(
      'input',
      `${method} gives ${element} no p exponent, yet a p orbital was listed on it`,
    );
  }
  const n = entry.principalQuantumNumber;
  return {
    element,
    n,
    l,
    zeta,
    ...contractSlaterShell(n, l, zeta),
  };
}
