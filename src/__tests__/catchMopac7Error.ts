import { Mopac7Error } from '../Mopac7Error.ts';

/**
 * Run something that must fail and hand back the `Mopac7Error` it threw, so a
 * test can assert on `code`, `message`, `input` and `output` at the top level
 * instead of inside a `catch`.
 * @param run - The call under test.
 * @returns The error it threw.
 * @throws {Error} When nothing was thrown, or something that is not a `Mopac7Error` was.
 */
export function catchMopac7Error(run: () => unknown): Mopac7Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Mopac7Error) return error;
    throw error;
  }
  throw new Error(
    'the call was expected to throw a Mopac7Error and returned instead',
  );
}

/**
 * The asynchronous form of {@link catchMopac7Error}.
 * @param run - The call under test.
 * @returns The error it rejected with.
 * @throws {Error} When the promise resolved, or rejected with something else.
 */
export async function catchMopac7ErrorAsync(
  run: () => Promise<unknown>,
): Promise<Mopac7Error> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Mopac7Error) return error;
    throw error;
  }
  throw new Error(
    'the call was expected to reject with a Mopac7Error and resolved instead',
  );
}
