import { expect, test } from 'vitest';

import { catchMopac7Error } from '../../__tests__/catchMopac7Error.ts';
import type { Mopac7Method } from '../../types.ts';
import { contractSlaterShell } from '../contractSlaterShell.ts';
import { MOPAC7_SLATER_EXPONENTS } from '../slaterExponents.ts';
import { MOPAC7_STO6G } from '../sto6g.ts';
import type { Mopac7SlaterPrimitives } from '../types.ts';

const METHODS: Mopac7Method[] = ['MNDO', 'MINDO3', 'AM1', 'PM3'];

/** Every shell the four hamiltonians can expand: one row per element and angular momentum. */
const SHELLS: Array<{
  method: Mopac7Method;
  element: string;
  n: number;
  l: number;
  zeta: number;
}> = [];
for (const method of METHODS) {
  for (const [element, entry] of Object.entries(
    MOPAC7_SLATER_EXPONENTS[method],
  )) {
    if (entry.orbitalCount === 9) continue;
    for (const l of [0, 1]) {
      const zeta = l === 0 ? entry.zetaS : entry.zetaP;
      if (zeta === null) continue;
      SHELLS.push({
        method,
        element,
        n: entry.principalQuantumNumber,
        l,
        zeta,
      });
    }
  }
}

test('every shell of every hamiltonian is normalised', () => {
  expect(SHELLS).toHaveLength(148);

  let worst = 0;
  let worstOutsideRowFour = 0;
  for (const shell of SHELLS) {
    const deviation = Math.abs(
      selfOverlap(contractSlaterShell(shell.n, shell.l, shell.zeta), shell.l) -
        1,
    );
    if (deviation > worst) worst = deviation;
    if (shell.n !== 4 && deviation > worstOutsideRowFour) {
      worstOutsideRowFour = deviation;
    }
  }

  // `setupg.f` prints the 4s and 4p rows of Stewart's table to seven significant
  // digits (`ALLZ(1,4,2) = 1.365346 D+00`, line 97) and every other row to ten,
  // so potassium through krypton — here chromium, zinc, gallium, germanium,
  // arsenic, selenium and bromine — normalise a thousand times less tightly than
  // the rest. It is MOPAC's own table, and 2e-7 is nothing to a drawn isosurface.
  expect(worst).toBeLessThan(2.1e-7);
  expect(worst).toBeGreaterThan(2e-7);
  expect(worstOutsideRowFour).toBeLessThan(5e-10);
  expect(MOPAC7_STO6G[3]?.[1]?.alpha[0]).toBe(1.365346);
  expect(MOPAC7_STO6G[4]?.[1]?.alpha[0]).toBe(0.7701420258);
});

test('the zeta² scaling and the normalisation are ELESP line for line', () => {
  // MNDO carbon 2s: zeta = 1.787537, so every gaussian exponent of the 2s row is
  // multiplied by zeta² = 3.195288...
  const zeta = 1.787537;
  const row = MOPAC7_STO6G[1]?.[0] as { alpha: readonly number[] };
  const shell = contractSlaterShell(2, 0, zeta);

  for (let index = 0; index < 6; index++) {
    expect(shell.exponents[index]).toBe(
      (row.alpha[index] as number) * zeta * zeta,
    );
  }
  // `NORM=(2.D0*EX/PI)**0.75D0*(4.D0*EX)**(IAM/2.D0)/SQRT(DEX(2*IAM-1))`, and
  // `DEX2(-1)` is 1, so for an s shell the angular factor and the divisor are
  // both 1.
  const alpha = shell.exponents[0] as number;

  expect(shell.coefficients[0]).toBe(
    -0.004151277819 * ((2 * alpha) / Math.PI) ** 0.75,
  );
});

test('a p shell carries the (4a)^(1/2) angular factor', () => {
  const shell = contractSlaterShell(2, 1, 1.685116);
  const row = MOPAC7_STO6G[1]?.[1] as { coefficient: readonly number[] };
  const alpha = shell.exponents[0] as number;

  // `DEX2(1)` is also 1, so the only difference from the s form is `(4a)^(l/2)`.
  expect(shell.coefficients[0]).toBe(
    (row.coefficient[0] as number) *
      ((2 * alpha) / Math.PI) ** 0.75 *
      Math.sqrt(4 * alpha),
  );
});

test('a shell MOPAC has no table row for is refused', () => {
  expect(catchMopac7Error(() => contractSlaterShell(7, 0, 1)).message).toBe(
    "MOPAC 7's STO-6G table has no n=7 l=0 shell; setupg.f holds 1s, and s and p for n=2 to 6",
  );
  // There is no 1p orbital, and MOPAC's table has no 1p row either.
  expect(
    catchMopac7Error(() => contractSlaterShell(1, 1, 1)).message,
  ).toContain('no n=1 l=1 shell');
  expect(
    catchMopac7Error(() => contractSlaterShell(2, 2, 1)).message,
  ).toContain('no n=2 l=2 shell');
  expect(catchMopac7Error(() => contractSlaterShell(2, 0, 0)).message).toBe(
    'the Slater exponent is 0, not positive',
  );
});

/**
 * The self-overlap of one contracted cartesian gaussian at its own centre, where
 * the gaussian product rule collapses to `(pi / p)^1.5` for an s orbital and
 * `(pi / p)^1.5 / (2 p)` for a p orbital.
 * @param shell - From {@link contractSlaterShell}.
 * @param l - `0` for s, `1` for p.
 * @returns `⟨χ|χ⟩`.
 */
function selfOverlap(shell: Mopac7SlaterPrimitives, l: number): number {
  let total = 0;
  for (let left = 0; left < shell.exponents.length; left++) {
    for (let right = 0; right < shell.exponents.length; right++) {
      const sum =
        (shell.exponents[left] as number) + (shell.exponents[right] as number);
      const oneDimensional = Math.sqrt(Math.PI / sum);
      let value = oneDimensional * oneDimensional * oneDimensional;
      if (l === 1) value *= 0.5 / sum;
      total +=
        (shell.coefficients[left] as number) *
        (shell.coefficients[right] as number) *
        value;
    }
  }
  return total;
}
