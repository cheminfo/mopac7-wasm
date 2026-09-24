/**
 * The cache in `compileMopac7` must hold a success and never a failure.
 *
 * Vitest gives each test file its own module registry, so this file starts with
 * the cache empty and can make the first call fail.
 */
import { expect, test, vi } from 'vitest';

import { compileMopac7 } from '../wasm/compileMopac7.ts';

test('a failed compile is not cached, so the next call still succeeds', async () => {
  vi.stubGlobal('DecompressionStream', function failing(): never {
    throw new Error('no DecompressionStream in this realm');
  });

  await expect(compileMopac7()).rejects.toThrow(
    'no DecompressionStream in this realm',
  );

  vi.unstubAllGlobals();

  const module = await compileMopac7();

  expect(module).toBeInstanceOf(WebAssembly.Module);
  // And that one is cached: the same object comes back.
  await expect(compileMopac7()).resolves.toBe(module);
});
