import { expect, test } from 'vitest';

import { catchMopac7Error } from '../../__tests__/catchMopac7Error.ts';
import { deorthogonalizeCoefficients } from '../deorthogonalizeCoefficients.ts';
import { mopac7Basis } from '../mopac7Basis.ts';
import { mopac7OverlapMatrix } from '../mopac7OverlapMatrix.ts';

import {
  CODATA_BOHR_PER_ANGSTROM,
  MOPAC23_OVERLAPS,
} from './mopac23Fixtures.ts';

const CASES = MOPAC23_OVERLAPS.jobs.map((job) => ({
  id: `${job.method}/${job.molecule}`,
  job,
}));

test.each(CASES)(
  '$id rebuilds the analytic Slater overlap MOPAC 23 printed',
  ({ job }) => {
    const basis = mopac7Basis(
      { ...job, basis: job.atomicOrbitals },
      { bohrPerAngstrom: CODATA_BOHR_PER_ANGSTROM },
    );
    const count = basis.functions.length;
    const ours = mopac7OverlapMatrix(basis);
    const theirs = lowerTriangle(job.overlapLowerTriangle, count);

    let worst = 0;
    let worstDiagonal = 0;
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) {
        const difference = Math.abs(
          (ours[row * count + column] as number) -
            (theirs[row * count + column] as number),
        );
        if (difference > worst) worst = difference;
      }
      const self = Math.abs((ours[row * count + row] as number) - 1);
      if (self > worstDiagonal) worstDiagonal = self;
    }

    expect(count).toBe(job.atomicOrbitals.length);
    // The residual is the six-gaussian expansion of a Slater orbital against
    // MOPAC's own analytic `diat`/`diat2`, not a parameter error: STO-3G on the
    // same exponents is forty times worse. The largest over these twelve jobs is
    // 1.243e-4, on PM3 benzene.
    expect(worst).toBeLessThan(1.3e-4);
    expect(worst).toBeGreaterThan(0);
    // Only n = 1 and n = 2 shells here, whose STO-6G rows `setupg.f` prints to
    // ten significant digits.
    expect(worstDiagonal).toBeLessThan(1.2e-10);
  },
);

test('the overlap is symmetric and the pi block of a planar ring is exactly zero', () => {
  const job = MOPAC23_OVERLAPS.jobs.find(
    (candidate) =>
      candidate.method === 'MNDO' && candidate.molecule === 'benzene',
  ) as (typeof MOPAC23_OVERLAPS.jobs)[number];
  const basis = mopac7Basis({ ...job, basis: job.atomicOrbitals });
  const count = basis.functions.length;
  const overlap = mopac7OverlapMatrix(basis);

  // Benzene lies in the z = 0 plane in MOPAC 23's frame, so every Pz orbital is
  // odd under reflection and its overlap with every sigma orbital vanishes — not
  // approximately, but to the last bit, because the one-dimensional factor is a
  // literal zero.
  let sigmaPi = 0;
  let asymmetry = 0;
  let piPairs = 0;
  for (let row = 0; row < count; row++) {
    const left = (basis.functions[row] as (typeof basis.functions)[number])
      .type;
    for (let column = 0; column < count; column++) {
      const right = (
        basis.functions[column] as (typeof basis.functions)[number]
      ).type;
      const value = overlap[row * count + column] as number;
      asymmetry = Math.max(
        asymmetry,
        Math.abs(value - (overlap[column * count + row] as number)),
      );
      if ((left === 'Pz') === (right === 'Pz')) continue;
      sigmaPi = Math.max(sigmaPi, Math.abs(value));
      piPairs++;
    }
  }

  expect(count).toBe(30);
  expect(asymmetry).toBe(0);
  expect(sigmaPi).toBe(0);
  expect(piPairs).toBe(2 * 6 * 24);
});

test('coefficients that are not a whole number of rows are refused', () => {
  const job = MOPAC23_OVERLAPS
    .jobs[0] as (typeof MOPAC23_OVERLAPS.jobs)[number];
  const basis = mopac7Basis({ ...job, basis: job.atomicOrbitals });
  const error = catchMopac7Error(() =>
    deorthogonalizeCoefficients(
      new Float64Array(basis.functions.length + 1),
      basis,
    ),
  );

  expect(error.code).toBe('input');
  expect(error.message).toBe(
    `${basis.functions.length + 1} coefficients are not a whole number of rows over a basis of ${basis.functions.length}`,
  );
});

/**
 * Unpack MOPAC's packed lower triangle into a row-major symmetric matrix.
 * @param values - The packed values, row by row.
 * @param size - The number of rows.
 * @returns `size²` entries.
 */
function lowerTriangle(values: readonly number[], size: number): Float64Array {
  if (values.length !== (size * (size + 1)) / 2) {
    throw new Error(
      `a ${size} by ${size} lower triangle holds ${(size * (size + 1)) / 2} values, and ${values.length} were given`,
    );
  }
  const full = new Float64Array(size * size);
  let index = 0;
  for (let row = 0; row < size; row++) {
    for (let column = 0; column <= row; column++) {
      full[row * size + column] = values[index] as number;
      full[column * size + row] = values[index] as number;
      index++;
    }
  }
  return full;
}
