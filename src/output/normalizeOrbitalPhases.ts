/**
 * Pin the phase of every molecular orbital, in place, so one wavefunction
 * always comes back with one set of signs.
 *
 * An eigenvector is only defined up to its sign: `c` and `-c` are the same
 * orbital, and which of the two a diagonaliser lands on depends on the rounding
 * inside its sweeps. Two builds of the very same MOPAC therefore print columns
 * that agree in magnitude and disagree in sign — on water at AM1, a native
 * build of this repository's own translated C and the WebAssembly build
 * disagree on three of the six columns, all magnitudes identical. Anything that
 * colours an orbital lobe by phase would then flip with the build, so the phase
 * is chosen here rather than inherited:
 *
 * **the coefficient of largest magnitude in each molecular orbital is made
 * positive**, and when several coefficients tie at that magnitude the earliest
 * one in basis order decides.
 *
 * A degenerate set is only defined up to a rotation inside its subspace, which
 * no sign convention can pin, and two builds do land on different rotations:
 * hydrogen fluoride under AM1 comes back as (0, -1) / (1, 0) from the
 * WebAssembly build and as (-0.3648, 0.9311) / (-0.9311, -0.3648) natively.
 * Both are orthonormal bases of the same plane, so a consumer must read a
 * degenerate set as a subspace: what agrees between builds is the projector
 * over the set, not the individual vectors.
 * @param coefficients - The coefficient matrix, orbital-major, modified in place.
 * @param basisSize - The number of atomic orbitals, i.e. the length of one column.
 * @returns The same array.
 */
export function normalizeOrbitalPhases(
  coefficients: Float64Array,
  basisSize: number,
): Float64Array {
  if (basisSize <= 0) return coefficients;
  const orbitals = Math.floor(coefficients.length / basisSize);
  for (let mo = 0; mo < orbitals; mo++) {
    const offset = mo * basisSize;
    let pivot = 0;
    let largest = 0;
    for (let ao = 0; ao < basisSize; ao++) {
      const magnitude = Math.abs(coefficients[offset + ao] as number);
      if (magnitude > largest) {
        largest = magnitude;
        pivot = ao;
      }
    }
    const sign = (coefficients[offset + pivot] as number) < 0 ? -1 : 1;
    for (let ao = 0; ao < basisSize; ao++) {
      // The `+ 0` is what keeps a flipped or printed `-.0000` from coming back
      // as -0, which compares unequal to 0 under Object.is.
      coefficients[offset + ao] =
        sign * (coefficients[offset + ao] as number) + 0;
    }
  }
  return coefficients;
}
