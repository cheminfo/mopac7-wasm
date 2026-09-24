import type { Mopac7ErrorCode } from './types.ts';

/**
 * Everything this package throws. It always carries the deck that produced the
 * failure and the listing as far as MOPAC got, because MOPAC 7 explains itself
 * in the listing and nowhere else — an emscripten abort, in particular, reaches
 * JavaScript as a bare `RuntimeError: unreachable` with no message at all.
 */
export class Mopac7Error extends Error {
  override readonly name = 'Mopac7Error';
  /** Which kind of failure this is. */
  readonly code: Mopac7ErrorCode;
  /** The `.dat` deck MOPAC was given, or `null` when the failure came before one was built. */
  readonly input: string | null;
  /** The listing, as far as MOPAC got, or `null` when MOPAC was never started. */
  readonly output: string | null;

  /**
   * Build an error for a failure MOPAC or this package detected.
   * @param code - Which kind of failure this is.
   * @param message - What went wrong, in one sentence.
   * @param context - The deck and the listing, when they exist.
   * @param context.input - The `.dat` deck MOPAC was given.
   * @param context.output - The listing produced so far.
   */
  constructor(
    code: Mopac7ErrorCode,
    message: string,
    context: { input?: string; output?: string } = {},
  ) {
    super(message);
    this.code = code;
    this.input = context.input ?? null;
    this.output = context.output ?? null;
  }
}
