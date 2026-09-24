/**
 * The numeric half of `compare-results.mjs`: what each block of a MOPAC result
 * is compared to, and how one block's worst difference is recorded.
 *
 * Tolerances are the printed precision of each block, because that is all a
 * MOPAC listing carries: the energies MOPAC prints to five decimals and the
 * orbital energies it prints to three must agree exactly, coefficients, charges
 * and coordinates to one unit in the fourth decimal, the dipole to one unit in
 * the third.
 */

/** What each block is compared to, in the unit MOPAC prints it in. */
export const TOLERANCES = {
  heatOfFormation: 0,
  ionizationPotential: 0,
  totalEnergy: 0,
  electronicEnergy: 0,
  coreCoreRepulsion: 0,
  orbitalEnergies: 0,
  coefficients: 1e-4,
  charges: 1e-4,
  electronDensities: 1e-4,
  dipole: 1e-3,
  coordinates: 1e-4,
};

/**
 * Record one block's worst difference, and add a line to `problems` when it is
 * outside that block's tolerance.
 * @param {object} fields - The per-block summary being built, written in place.
 * @param {string[]} problems - The failure lines, appended to in place.
 * @param {string} name - The block's name, which is also its key in TOLERANCES.
 * @param {number[]} values - One absolute difference per value in the block.
 * @param {number[]|Float64Array} samples - The values themselves, for the message.
 * @returns {void} Nothing; both arguments are written in place.
 */
export function record(fields, problems, name, values, samples) {
  const tolerance = TOLERANCES[name] ?? 0;
  let worst = 0;
  let at = -1;
  for (let index = 0; index < values.length; index++) {
    if (values[index] > worst) {
      worst = values[index];
      at = index;
    }
  }
  const ok = worst <= tolerance;

  fields[name] = { worst, tolerance, at, count: values.length, ok };
  if (!ok) {
    problems.push(
      `${name}: worst |difference| ${worst.toExponential(3)} at index ${at} ` +
        `(tolerance ${tolerance.toExponential(3)}, value ${String(samples[at])})`,
    );
  }
}

/**
 * The absolute difference of every element of two equally long sequences.
 * @param {number[]|Float64Array} got - The values under test.
 * @param {number[]|Float64Array} want - The values they have to match.
 * @returns {number[]} One difference per element, or a single `Infinity` when the
 *   two lengths do not even match.
 */
export function differences(got, want) {
  if (got.length !== want.length) return [Number.POSITIVE_INFINITY];
  const values = new Array(got.length);
  for (let index = 0; index < got.length; index++) {
    values[index] = Math.abs(got[index] - want[index]);
  }
  return values;
}

/**
 * The same, for the four components of a dipole that may be absent altogether.
 * @param {object|null} got - The dipole under test.
 * @param {object|null} want - The dipole it has to match.
 * @returns {number[]} One difference per component.
 */
export function dipoleDifferences(got, want) {
  if (got === null || want === null) {
    return [got === want ? 0 : Number.POSITIVE_INFINITY];
  }
  const values = [];
  for (const axis of ['x', 'y', 'z', 'total']) {
    values.push(Math.abs(got[axis] - want[axis]));
  }
  return values;
}
