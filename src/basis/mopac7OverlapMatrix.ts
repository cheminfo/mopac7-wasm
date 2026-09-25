import type { Mopac7Basis } from './types.ts';

/**
 * The overlap matrix of a reconstructed basis, `S[i][j] = ⟨χᵢ|χⱼ⟩`, row-major.
 *
 * This is the metric MOPAC's own analytic Slater code (`diat.f` / `diat2.f`)
 * computes, rebuilt from the STO-6G expansion: over water, formaldehyde, benzene
 * and pyridine under MNDO, AM1 and PM3 it agrees with the `OVERLAP_MATRIX`
 * MOPAC 23 prints to 1.2e-4, which is the residual of the six-gaussian
 * expansion itself and not a parameter error — STO-3G on the same exponents is
 * forty times worse.
 *
 * Every diagonal entry is 1, to 1.2e-10 for the shells of the first three rows of
 * the periodic table and to 2.1e-7 for the fourth, because `contractSlaterShell`
 * folds the normalisation in and `setupg.f` prints its 4s and 4p row to seven
 * significant digits rather than ten.
 *
 * It is needed for two things: to check that a drawn orbital is normalised, and
 * to turn MOPAC's ZDO coefficients into coefficients over these orbitals. See
 * `deorthogonalizeCoefficients`.
 * @param basis - From `mopac7Basis`.
 * @returns `functions.length²` entries, row-major and symmetric.
 */
export function mopac7OverlapMatrix(basis: Mopac7Basis): Float64Array {
  const { functions, shells, centers } = basis;
  const count = functions.length;
  const overlap = new Float64Array(count * count);
  for (let row = 0; row < count; row++) {
    const left = functions[row] as Mopac7Basis['functions'][number];
    const leftShell = shells[left.shell] as Mopac7Basis['shells'][number];
    const leftAtom = left.atomIndex * 3;
    for (let column = row; column < count; column++) {
      const right = functions[column] as Mopac7Basis['functions'][number];
      const rightShell = shells[right.shell] as Mopac7Basis['shells'][number];
      const rightAtom = right.atomIndex * 3;
      let total = 0;
      for (let p = 0; p < leftShell.exponents.length; p++) {
        const a = leftShell.exponents[p] as number;
        const ca = leftShell.coefficients[p] as number;
        for (let q = 0; q < rightShell.exponents.length; q++) {
          total +=
            ca *
            (rightShell.coefficients[q] as number) *
            primitiveOverlap(
              a,
              centers,
              leftAtom,
              left.powers,
              rightShell.exponents[q] as number,
              rightAtom,
              right.powers,
            );
        }
      }
      overlap[row * count + column] = total;
      overlap[column * count + row] = total;
    }
  }
  return overlap;
}

/**
 * The overlap of two primitive cartesian gaussians, through the gaussian product
 * rule. Only the powers an s or p shell produces are handled, which is all MOPAC
 * 7's own STO-6G table can expand.
 * @param a - Exponent of the left primitive.
 * @param centers - Atom centres in bohr, three per atom.
 * @param offsetA - Index of the left centre's x coordinate.
 * @param powersA - Cartesian powers of the left orbital.
 * @param b - Exponent of the right primitive.
 * @param offsetB - Index of the right centre's x coordinate.
 * @param powersB - Cartesian powers of the right orbital.
 * @returns The overlap.
 */
function primitiveOverlap(
  a: number,
  centers: Float64Array,
  offsetA: number,
  powersA: readonly [number, number, number],
  b: number,
  offsetB: number,
  powersB: readonly [number, number, number],
): number {
  const sum = a + b;
  let squared = 0;
  for (let axis = 0; axis < 3; axis++) {
    const difference =
      (centers[offsetA + axis] as number) - (centers[offsetB + axis] as number);
    squared += difference * difference;
  }
  // (pi / p)^1.5, written as three factors of the one-dimensional gaussian
  // integral so the three axes read alike.
  const oneDimensional = Math.sqrt(Math.PI / sum);
  let value =
    Math.exp((-a * b * squared) / sum) *
    oneDimensional *
    oneDimensional *
    oneDimensional;
  for (let axis = 0; axis < 3; axis++) {
    const centerA = centers[offsetA + axis] as number;
    const centerB = centers[offsetB + axis] as number;
    const product = (a * centerA + b * centerB) / sum;
    value *= axisFactor(
      powersA[axis] as number,
      powersB[axis] as number,
      product - centerA,
      product - centerB,
      sum,
    );
  }
  return value;
}

/**
 * The one-dimensional factor of the gaussian product rule, for powers 0 and 1.
 * @param left - Power on the left orbital, 0 or 1.
 * @param right - Power on the right orbital, 0 or 1.
 * @param fromA - Product centre minus the left centre.
 * @param fromB - Product centre minus the right centre.
 * @param sum - The sum of the two exponents.
 * @returns The factor.
 */
function axisFactor(
  left: number,
  right: number,
  fromA: number,
  fromB: number,
  sum: number,
): number {
  if (left === 0) return right === 0 ? 1 : fromB;
  if (right === 0) return fromA;
  return fromA * fromB + 0.5 / sum;
}
