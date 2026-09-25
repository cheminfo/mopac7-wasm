import { Mopac7Error } from '../Mopac7Error.ts';

import { MOPAC7_STO6G } from './sto6g.ts';
import type { Mopac7SlaterPrimitives } from './types.ts';

/**
 * Expand one Slater orbital into the six contracted cartesian gaussians MOPAC
 * itself uses, so it can be evaluated on a grid.
 *
 * This is `esp.rof` `ELESP` line for line. It takes Stewart's `zeta = 1` table
 * from `setupg.f` `SETUPG`, scales every gaussian exponent by `zeta²`
 * (`EX(NPR+J)=ALLZ(J,NQN,1)*ZS(IAN(I))**2`, line 738, and the `ZP` form at line
 * 750), and folds the cartesian normalisation into every coefficient
 * (`NORM=(2.D0*EX(I)/PI)**0.75D0*(4.D0*EX(I))**(IAM(I,1)/2.D0)/SQRT(DEX(2*IAM(I,1)-1))`,
 * lines 766 to 769). `DEX` there is `esp.rof`'s own double factorial `DEX2`
 * (lines 957 to 967), and it returns 1 for every argument below 2 — so for the s
 * and p shells this can reach, `2l - 1` is -1 or 1 and the divisor is exactly 1.
 * It would only start to bite at a d shell, which MOPAC has no table row for.
 *
 * The result is normalised: the self-overlap of the orbital it describes is 1 to
 * 1.2e-10, or to 2.1e-7 for the 4s and 4p shells, whose table row `setupg.f`
 * prints to seven significant digits rather than ten.
 * `__tests__/contractSlaterShell.test.ts` asserts it for all 148 shells of every
 * element of every hamiltonian.
 * @param n - Principal quantum number, 1 to 6.
 * @param l - Angular momentum: `0` for s, `1` for p.
 * @param zeta - The Slater exponent, in reciprocal bohr.
 * @returns The six exponents and the six normalised coefficients.
 * @throws {Mopac7Error} With `code: 'input'` when MOPAC's table has no such shell.
 */
export function contractSlaterShell(
  n: number,
  l: number,
  zeta: number,
): Mopac7SlaterPrimitives {
  const expansion = MOPAC7_STO6G[n - 1]?.[l] ?? null;
  if (expansion === null) {
    throw new Mopac7Error(
      'input',
      `MOPAC 7's STO-6G table has no n=${n} l=${l} shell; setupg.f holds 1s, and s and p for n=2 to 6`,
    );
  }
  if (!(zeta > 0)) {
    throw new Mopac7Error(
      'input',
      `the Slater exponent is ${zeta}, not positive`,
    );
  }
  const count = expansion.alpha.length;
  const exponents = new Float64Array(count);
  const coefficients = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    const alpha = (expansion.alpha[index] as number) * zeta * zeta;
    // `(4 a)^(l / 2)`, and `(4 a)^0.5` is bit-exact `Math.sqrt(4 a)`.
    const angular = l === 0 ? 1 : Math.sqrt(4 * alpha);
    exponents[index] = alpha;
    coefficients[index] =
      (expansion.coefficient[index] as number) *
      ((2 * alpha) / Math.PI) ** 0.75 *
      angular;
  }
  return { exponents, coefficients };
}
