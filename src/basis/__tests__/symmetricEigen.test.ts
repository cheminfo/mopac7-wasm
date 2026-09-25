import { expect, test } from 'vitest';

import { catchMopac7Error } from '../../__tests__/catchMopac7Error.ts';
import { inverseSqrtOverlap } from '../deorthogonalizeCoefficients.ts';
import { symmetricEigen } from '../symmetricEigen.ts';

test('a two by two matrix with eigenvalues that can be written down', () => {
  // [[2, 1], [1, 2]] has eigenvalues 1 and 3, eigenvectors (1, -1)/sqrt2 and (1, 1)/sqrt2.
  const { values, vectors } = symmetricEigen(Float64Array.of(2, 1, 1, 2), 2);

  expect(values[0]).toBeCloseTo(1, 15);
  expect(values[1]).toBeCloseTo(3, 15);
  expect(Math.abs(vectors[0] as number)).toBeCloseTo(Math.SQRT1_2, 15);
  expect((vectors[0] as number) * (vectors[2] as number)).toBeCloseTo(-0.5, 15);
  expect((vectors[1] as number) * (vectors[3] as number)).toBeCloseTo(0.5, 15);
});

test('a diagonal matrix comes back in ascending order with the identity', () => {
  const { values, vectors } = symmetricEigen(
    Float64Array.of(3, 0, 0, 0, 1, 0, 0, 0, 2),
    3,
  );

  expect(Array.from(values)).toStrictEqual([1, 2, 3]);
  // Column 0 is the eigenvector of 1, which is the second basis vector.
  expect(Array.from(vectors)).toStrictEqual([0, 0, 1, 1, 0, 0, 0, 1, 0]);
});

test('the eigenvectors of a nine by nine matrix are orthonormal and reproduce it', () => {
  const size = 9;
  const matrix = new Float64Array(size * size);
  for (let row = 0; row < size; row++) {
    for (let column = row; column < size; column++) {
      // A deterministic, strictly diagonally dominant symmetric matrix.
      const value =
        row === column ? 10 + row : 1 / (1 + Math.abs(row - column) ** 2);
      matrix[row * size + column] = value;
      matrix[column * size + row] = value;
    }
  }
  const { values, vectors } = symmetricEigen(matrix, size);

  for (let left = 0; left < size; left++) {
    for (let right = 0; right < size; right++) {
      let overlap = 0;
      let rebuilt = 0;
      for (let index = 0; index < size; index++) {
        overlap +=
          (vectors[index * size + left] as number) *
          (vectors[index * size + right] as number);
      }
      for (let index = 0; index < size; index++) {
        rebuilt +=
          (vectors[left * size + index] as number) *
          (values[index] as number) *
          (vectors[right * size + index] as number);
      }

      expect(overlap).toBeCloseTo(left === right ? 1 : 0, 14);
      expect(rebuilt).toBeCloseTo(matrix[left * size + right] as number, 13);
    }
  }

  expect(values[0]).toBeGreaterThan(9);
});

test('the inverse square root squares back to the inverse', () => {
  // [[4, 1], [1, 4]]: S^(-1/2) S S^(-1/2) must be the identity.
  const size = 2;
  const overlap = Float64Array.of(4, 1, 1, 4);
  const root = inverseSqrtOverlap(overlap, size);

  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      let total = 0;
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          total +=
            (root[row * size + i] as number) *
            (overlap[i * size + j] as number) *
            (root[j * size + column] as number);
        }
      }

      expect(total).toBeCloseTo(row === column ? 1 : 0, 14);
    }
  }

  expect(root[0]).toBeCloseTo(root[3] as number, 15);
});

test('a matrix of the wrong length, and one with no inverse square root', () => {
  expect(
    catchMopac7Error(() => symmetricEigen(Float64Array.of(1, 2, 3), 2)).message,
  ).toBe('a 2 by 2 matrix needs 4 entries, and 3 were given');
  // [[1, 1], [1, 1]] is singular: its smaller eigenvalue is 0.
  expect(
    catchMopac7Error(() => inverseSqrtOverlap(Float64Array.of(1, 1, 1, 1), 2))
      .message,
  ).toContain('has no inverse square root');
});
