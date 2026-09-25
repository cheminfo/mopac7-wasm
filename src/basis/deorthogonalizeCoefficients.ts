import { Mopac7Error } from '../Mopac7Error.ts';

import { mopac7OverlapMatrix } from './mopac7OverlapMatrix.ts';
import { symmetricEigen } from './symmetricEigen.ts';
import type { Mopac7Basis } from './types.ts';

/**
 * Turn MOPAC's ZDO coefficients into coefficients over the real, non-orthogonal
 * Slater orbitals `mopac7Basis` describes: `C_AO = S^(-1/2) C_ZDO`.
 *
 * This is what MOPAC itself does before a Mulliken population analysis
 * (`mullik.f` with `mult.f`) and before an ESP fit (`esp.rof` `ELESP`, which
 * calls `RSP` on the overlap and forms `Σ_k v_ik v_jk / √λ_k` at line 904). NDDO
 * neglects diatomic overlap, so MOPAC's eigenvectors are orthonormal over an
 * identity metric while `Cᵀ S C` over the real Slater overlap is not: over water,
 * benzene and pyridine at all four hamiltonians the worst `⟨ψ|ψ⟩` is 2.26 under
 * MNDO and 2.78 under PM3, for orbitals the method calls normalised.
 *
 * `S^(-1/2)` is an exact isometry between the two metrics, so afterwards
 * `C_AOᵀ S C_AO` departs from the identity by exactly as much as `Cᵀ C` already
 * did, and no more. For MOPAC 7 that floor is 2.4e-4, because it prints its
 * eigenvectors to four decimals; over the nine-figure vectors MOPAC 23 writes to
 * its `.aux` file the same transform lands at 1.7e-13.
 *
 * **It barely changes the picture.** Over 228 occupied orbitals of water,
 * formaldehyde, furan and benzene, collocated on a 0.3 bohr grid, not one node
 * moved and not one lobe flipped: there was no voxel of opposite sign inside the
 * isosurface in any of them, every π orbital and every HOMO came out identical,
 * and where the two differ most — the deepest valence σ level of an
 * oxygen-bearing molecule — the de-orthogonalised region is strictly contained in
 * the raw one. The diagonal error cannot show at all, because an isovalue picked
 * as a quantile of the sampled field has no scale of its own. So call this
 * because it is the correct thing to draw, not because the drawing needs it.
 * @param coefficients - A result's `coefficients`: orbital-major, `mo * basis.functions.length + ao`.
 * @param basis - From `mopac7Basis`.
 * @param overlap - A previously computed overlap matrix, to save recomputing it.
 * @returns A new array of the same length and layout.
 * @throws {Mopac7Error} With `code: 'input'` when the length is not a multiple of the basis size.
 */
export function deorthogonalizeCoefficients(
  coefficients: Float64Array,
  basis: Mopac7Basis,
  overlap?: Float64Array,
): Float64Array {
  const count = basis.functions.length;
  if (count === 0 || coefficients.length % count !== 0) {
    throw new Mopac7Error(
      'input',
      `${coefficients.length} coefficients are not a whole number of rows over a basis of ${count}`,
    );
  }
  const root = inverseSqrtOverlap(overlap ?? mopac7OverlapMatrix(basis), count);
  const orbitals = coefficients.length / count;
  const transformed = new Float64Array(coefficients.length);
  for (let orbital = 0; orbital < orbitals; orbital++) {
    const offset = orbital * count;
    for (let row = 0; row < count; row++) {
      let total = 0;
      for (let column = 0; column < count; column++) {
        total +=
          (root[row * count + column] as number) *
          (coefficients[offset + column] as number);
      }
      transformed[offset + row] = total;
    }
  }
  return transformed;
}

/**
 * The inverse square root of a symmetric positive-definite matrix, through its
 * own eigendecomposition: `S^(-1/2) = Σ_k v_k v_kᵀ / √λ_k`.
 *
 * MOPAC 7 can be asked to write its own `S^(-1/2)` to `FOR013` with the `GRAPH`
 * keyword (`mullik.f`), but only to the four decimals that file carries.
 * Recomputing it from the reconstructed overlap is both cheaper for the caller
 * and better: measured against the same coefficients, MOPAC's printed copy
 * restores orthonormality to 5.4e-9 where recomputing reaches 5.3e-15.
 * @param overlap - `size²` entries, row-major and symmetric positive-definite.
 * @param size - The number of rows.
 * @returns `size²` entries, row-major and symmetric.
 * @throws {Mopac7Error} With `code: 'input'` when the matrix is singular or not positive-definite.
 */
export function inverseSqrtOverlap(
  overlap: Float64Array,
  size: number,
): Float64Array {
  const { values, vectors } = symmetricEigen(overlap, size);
  const smallest = values[0] as number;
  if (!(smallest > 0)) {
    throw new Mopac7Error(
      'input',
      `the overlap matrix has an eigenvalue of ${smallest}, so it has no inverse square root`,
    );
  }
  const scale = new Float64Array(size);
  for (let index = 0; index < size; index++) {
    scale[index] = 1 / Math.sqrt(values[index] as number);
  }
  const root = new Float64Array(size * size);
  for (let row = 0; row < size; row++) {
    for (let column = row; column < size; column++) {
      let total = 0;
      for (let k = 0; k < size; k++) {
        total +=
          (vectors[row * size + k] as number) *
          (vectors[column * size + k] as number) *
          (scale[k] as number);
      }
      root[row * size + column] = total;
      root[column * size + row] = total;
    }
  }
  return root;
}
