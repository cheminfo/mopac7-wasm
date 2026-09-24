import { expect, test } from 'vitest';

import { normalizeOrbitalPhases } from '../output/normalizeOrbitalPhases.ts';

test('a column whose largest coefficient is negative is turned over', () => {
  const coefficients = new Float64Array([0.3, -0.9, 0.2]);

  normalizeOrbitalPhases(coefficients, 3);

  expect(Array.from(coefficients)).toStrictEqual([-0.3, 0.9, -0.2]);
});

test('a column whose largest coefficient is positive is left alone', () => {
  const coefficients = new Float64Array([-0.3, 0.9, -0.2]);

  normalizeOrbitalPhases(coefficients, 3);

  expect(Array.from(coefficients)).toStrictEqual([-0.3, 0.9, -0.2]);
});

test('the two sign choices of one orbital normalise to the same column', () => {
  const printed = new Float64Array([0, 0.6067, -0.4742, 0, 0.4511, -0.4511]);
  const flipped = new Float64Array([0, -0.6067, 0.4742, 0, -0.4511, 0.4511]);

  normalizeOrbitalPhases(printed, 6);
  normalizeOrbitalPhases(flipped, 6);

  expect(Array.from(flipped)).toStrictEqual(Array.from(printed));
  expect(Array.from(printed)).toStrictEqual([
    0, 0.6067, -0.4742, 0, 0.4511, -0.4511,
  ]);
});

test('each orbital of a matrix is turned on its own', () => {
  const coefficients = new Float64Array([
    0.8, 0.1, -0.9, 0.2, 0.3, -0.7, -0.5, 0.4,
  ]);

  normalizeOrbitalPhases(coefficients, 2);

  expect(Array.from(coefficients)).toStrictEqual([
    0.8, 0.1, 0.9, -0.2, -0.3, 0.7, 0.5, -0.4,
  ]);
});

test('ties at the largest magnitude are broken by the earliest atomic orbital', () => {
  const coefficients = new Float64Array([-0.5, 0.5, 0.1]);

  normalizeOrbitalPhases(coefficients, 3);

  expect(Array.from(coefficients)).toStrictEqual([0.5, -0.5, -0.1]);
});

test('no coefficient comes back as negative zero', () => {
  const coefficients = new Float64Array([0, -0, -1, 0]);

  normalizeOrbitalPhases(coefficients, 4);

  expect(Array.from(coefficients)).toStrictEqual([0, 0, 1, 0]);
  expect(Object.is(coefficients[0], 0)).toBe(true);
  expect(Object.is(coefficients[3], 0)).toBe(true);
});

test('an all-zero column is left as it is rather than turned', () => {
  const coefficients = new Float64Array([0, 0, 0]);

  normalizeOrbitalPhases(coefficients, 3);

  expect(Array.from(coefficients)).toStrictEqual([0, 0, 0]);
});
