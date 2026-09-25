import type { Mopac7AtomicOrbital, Mopac7Method } from '../types.ts';

/** One of Stewart's STO-6G expansions, before it is scaled and normalised. */
export interface Mopac7StoExpansion {
  /** `ALLZ(j, n, l + 1)` of `setupg.f`: six gaussian exponents for `zeta = 1`. */
  alpha: readonly number[];
  /** `ALLC(j, n, l + 1)`: six contraction coefficients, not yet normalised. */
  coefficient: readonly number[];
}

/** What one hamiltonian gives one element: its valence shells and their exponents. */
export interface Mopac7ElementBasis {
  /** MOPAC's atomic number for the element. */
  atomicNumber: number;
  /** `NPQ` of `diat.f`: the principal quantum number of the valence shell. */
  principalQuantumNumber: number;
  /** `NATORB` of `block.f`: how many atomic orbitals MOPAC gives the atom — 1, 4 or 9. */
  orbitalCount: number;
  /** `ZS`: the valence s Slater exponent, in reciprocal bohr. */
  zetaS: number;
  /** `ZP`: the valence p Slater exponent, or `null` when the atom has only an s shell. */
  zetaP: number | null;
}

/** One contracted gaussian, ready to evaluate. */
export interface Mopac7SlaterPrimitives {
  /** The six gaussian exponents, in reciprocal bohr squared. */
  exponents: Float64Array;
  /** The six contraction coefficients, with the cartesian normalisation folded in. */
  coefficients: Float64Array;
}

/** One Slater shell of the reconstructed basis, expanded into gaussians. */
export interface Mopac7BasisShell extends Mopac7SlaterPrimitives {
  /** The element symbol the shell belongs to. */
  element: string;
  /** Principal quantum number. */
  n: number;
  /** Angular momentum: `0` for s, `1` for p. */
  l: number;
  /** The Slater exponent this shell expands, in reciprocal bohr. */
  zeta: number;
}

/**
 * One atomic orbital of the reconstructed basis, at the same index as the
 * matching entry of a result's own `basis`.
 */
export interface Mopac7BasisFunction {
  /** 0-based index into the result's `elements`, and into `centers` times three. */
  atomIndex: number;
  /** The element symbol. */
  element: string;
  /** MOPAC's own orbital label: `'S'`, `'Px'`, `'Py'` or `'Pz'`. */
  type: string;
  /** Index into {@link Mopac7Basis.shells}; several orbitals share one shell. */
  shell: number;
  /** Cartesian powers `[x, y, z]`: `[0, 0, 0]` for s, `[1, 0, 0]` for `Px`. */
  powers: readonly [number, number, number];
}

/**
 * The Slater basis one MOPAC 7 result was computed in, expanded into contracted
 * cartesian gaussians so an orbital can be collocated on a grid.
 */
export interface Mopac7Basis {
  /** The hamiltonian whose exponents this is. */
  method: Mopac7Method;
  /** The distinct shells, one per element and angular momentum in the molecule. */
  shells: Mopac7BasisShell[];
  /** One entry per atomic orbital, in the row order of the result's `coefficients`. */
  functions: Mopac7BasisFunction[];
  /** Atom centres in bohr, three per atom, in the result's `elements` order. */
  centers: Float64Array;
  /** The ångström-to-bohr divisor that produced `centers`. */
  bohrPerAngstrom: number;
}

/** The parts of a `Mopac7Result` a basis is built from. */
export interface Mopac7BasisInput {
  /** The hamiltonian. */
  method: Mopac7Method;
  /** Element symbols in MOPAC's atom order. */
  elements: readonly string[];
  /** Cartesian coordinates in ångström, flat, three per atom. */
  coordinates: ArrayLike<number>;
  /** The atomic orbitals in the row order of the coefficients. */
  basis: readonly Mopac7AtomicOrbital[];
}

/** How to build the basis. */
export interface Mopac7BasisOptions {
  /**
   * The ångström-to-bohr divisor. The default is MOPAC 7's own, hard-coded at
   * `diat.f` line 142 and in six more of its files, so the reconstructed overlap
   * is metrically the one MOPAC 7's coefficients were computed against. Pass
   * `0.529177210903` to compare with a program that uses the CODATA value —
   * MOPAC 23 does, and the two differ by 19 parts per million.
   * @default 0.529167
   */
  bohrPerAngstrom?: number;
}
