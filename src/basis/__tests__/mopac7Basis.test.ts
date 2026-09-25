import { expect, test } from 'vitest';

import type { MoleculeName } from '../../__tests__/molecules.ts';
import { MOLECULES } from '../../__tests__/molecules.ts';
import { mopac7 } from '../../mopac7.ts';
import type { Mopac7Method, Mopac7Result } from '../../types.ts';
import { deorthogonalizeCoefficients } from '../deorthogonalizeCoefficients.ts';
import { mopac7AtomicOrbitals } from '../mopac7AtomicOrbitals.ts';
import { MOPAC7_BOHR_PER_ANGSTROM, mopac7Basis } from '../mopac7Basis.ts';
import { mopac7OverlapMatrix } from '../mopac7OverlapMatrix.ts';

const NAMES: MoleculeName[] = ['water', 'benzene', 'pyridine'];
const METHODS: Mopac7Method[] = ['MNDO', 'MINDO3', 'AM1', 'PM3'];
const CASES: Array<{ name: MoleculeName; method: Mopac7Method }> = [];
for (const name of NAMES) {
  for (const method of METHODS) CASES.push({ name, method });
}

/** Water is s+p on one oxygen, benzene is one shell pair over twelve atoms, pyridine adds nitrogen. */
const EXPECTED: Record<MoleculeName, { functions: number; shells: number }> = {
  water: { functions: 6, shells: 3 },
  benzene: { functions: 30, shells: 3 },
  pyridine: { functions: 29, shells: 5 },
};

test.each(CASES)(
  '$name $method: the basis matches the listing MOPAC printed',
  async ({ name, method }) => {
    const result = await mopac7({ ...MOLECULES[name], method });
    const basis = mopac7Basis(result);
    const expected = EXPECTED[name];

    expect(basis.method).toBe(method);
    expect(basis.bohrPerAngstrom).toBe(MOPAC7_BOHR_PER_ANGSTROM);
    expect(basis.functions).toHaveLength(expected.functions);
    expect(basis.shells).toHaveLength(expected.shells);
    expect(basis.centers).toHaveLength(result.elements.length * 3);
    expect(result.coefficients).toHaveLength(
      expected.functions * expected.functions,
    );

    // The atomic-orbital order this package derives from `NATORB` and `ATORBS`
    // is MOPAC's own, so it reproduces the printed rows exactly.
    expect(mopac7AtomicOrbitals(result.elements, method)).toStrictEqual(
      result.basis,
    );

    for (let index = 0; index < basis.functions.length; index++) {
      const orbital = result.basis[index] as Mopac7Result['basis'][number];
      const built = basis.functions[index] as (typeof basis.functions)[number];

      expect(built.atomIndex).toBe(orbital.atomIndex);
      expect(built.element).toBe(orbital.element);
      expect(built.type).toBe(orbital.type);

      const shell = basis.shells[built.shell] as (typeof basis.shells)[number];

      expect(shell.element).toBe(orbital.element);
      expect(shell.l).toBe(orbital.type === 'S' ? 0 : 1);
      expect(shell.exponents).toHaveLength(6);
      expect(shell.coefficients).toHaveLength(6);
    }
    for (let atom = 0; atom < result.elements.length; atom++) {
      for (let axis = 0; axis < 3; axis++) {
        expect(basis.centers[atom * 3 + axis]).toBeCloseTo(
          (result.coordinates[atom * 3 + axis] as number) /
            MOPAC7_BOHR_PER_ANGSTROM,
          12,
        );
      }
    }
  },
);

test.each(CASES)(
  '$name $method: ZDO coefficients are not orthonormal over the Slater overlap, and S^(-1/2) makes them so',
  async ({ name, method }) => {
    const result = await mopac7({ ...MOLECULES[name], method });
    const basis = mopac7Basis(result);
    const count = basis.functions.length;
    const overlap = mopac7OverlapMatrix(basis);

    for (let index = 0; index < count; index++) {
      expect(overlap[index * count + index]).toBeCloseTo(1, 9);
    }

    // Over the real, non-orthogonal Slater orbitals the printed vectors are far
    // from orthonormal: this is the whole ZDO approximation, made visible.
    const raw = worstDeviation(result.coefficients, overlap, count);

    expect(raw.diagonal).toBeGreaterThan(name === 'water' ? 0.4 : 1);

    // Over an identity metric they are orthonormal to the four decimals MOPAC
    // prints them at, and `S^(-1/2)` is an exact isometry between the two
    // metrics — so after it the residual is that printing resolution and
    // nothing else.
    const identity = new Float64Array(count * count);
    for (let index = 0; index < count; index++) {
      identity[index * count + index] = 1;
    }
    const printed = worstDeviation(result.coefficients, identity, count);
    const fixed = worstDeviation(
      deorthogonalizeCoefficients(result.coefficients, basis, overlap),
      overlap,
      count,
    );

    expect(printed.diagonal).toBeLessThan(3e-4);
    expect(fixed.diagonal).toBeCloseTo(printed.diagonal, 10);
    expect(fixed.offDiagonal).toBeCloseTo(printed.offDiagonal, 10);
  },
);

test('a sodium sparkle carries a centre and no basis function', async () => {
  const result = await mopac7({
    elements: ['Na', 'Cl'],
    coordinates: [
      [0, 0, 0],
      [2.361, 0, 0],
    ],
    method: 'MNDO',
  });
  const basis = mopac7Basis(result);

  // `block.f` gives atomic number 11 `NATORB = 0` and no exponent, so MOPAC
  // itself prints no row for it — the four rows are chlorine's 3s and 3p.
  expect(result.basis.map((orbital) => orbital.atomIndex)).toStrictEqual([
    1, 1, 1, 1,
  ]);
  expect(mopac7AtomicOrbitals(result.elements, 'MNDO')).toStrictEqual(
    result.basis,
  );
  expect(basis.functions).toHaveLength(4);
  expect(
    basis.shells.map(
      (shell) => `${shell.element} ${shell.n}${'sp'[shell.l]} ${shell.zeta}`,
    ),
  ).toStrictEqual(['Cl 3s 3.784645', 'Cl 3p 2.036263']);
  // Both atoms still have a centre, so `atomIndex` indexes `centers` directly.
  expect(basis.centers).toHaveLength(6);
  expect(basis.centers[3]).toBeCloseTo(2.230864736463158, 12);
});

test('the overlap matrix is computed when none is handed in', async () => {
  const result = await mopac7({ ...MOLECULES.water, method: 'MNDO' });
  const basis = mopac7Basis(result);
  const overlap = mopac7OverlapMatrix(basis);

  expect(
    Array.from(deorthogonalizeCoefficients(result.coefficients, basis)),
  ).toStrictEqual(
    Array.from(
      deorthogonalizeCoefficients(result.coefficients, basis, overlap),
    ),
  );
});

/**
 * The largest departure of `Cᵀ M C` from the identity, over every printed
 * molecular orbital.
 * @param coefficients - Orbital-major coefficients.
 * @param metric - `count²` entries, row-major.
 * @param count - The number of atomic orbitals.
 * @returns The worst diagonal and off-diagonal deviations.
 */
function worstDeviation(
  coefficients: Float64Array,
  metric: Float64Array,
  count: number,
): { diagonal: number; offDiagonal: number } {
  let diagonal = 0;
  let offDiagonal = 0;
  const product = new Float64Array(count);
  for (let left = 0; left < count; left++) {
    for (let right = left; right < count; right++) {
      for (let row = 0; row < count; row++) {
        let sum = 0;
        for (let column = 0; column < count; column++) {
          sum +=
            (metric[row * count + column] as number) *
            (coefficients[right * count + column] as number);
        }
        product[row] = sum;
      }
      let total = 0;
      for (let row = 0; row < count; row++) {
        total +=
          (coefficients[left * count + row] as number) *
          (product[row] as number);
      }
      const deviation = Math.abs(total - (left === right ? 1 : 0));
      if (left === right) {
        if (deviation > diagonal) diagonal = deviation;
      } else if (deviation > offDiagonal) {
        offDiagonal = deviation;
      }
    }
  }
  return { diagonal, offDiagonal };
}
