import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { decode } from 'uint8-base64';
import { expect, test } from 'vitest';

import { wasmGzipBase64 } from '../../wasm/data.js';
import { MOPAC7_LIMITS } from '../limits.ts';

/**
 * `wasm/data.js` is a committed build artefact, so it is checked rather than
 * trusted, on every machine and every CI run, with no emscripten needed.
 *
 * The digest is of what the payload DECOMPRESSES TO, never of the payload
 * itself: deflate output differs between node releases on identical input, so
 * hashing the compressed bytes would fail a rebuild that changed nothing.
 */
const build: {
  program: { version: string };
  source: { commit: string; treeSha256: string };
  limits: Record<string, number>;
  payload: { wasmBytes: number; wasmSha256: string; base64Characters: number };
} = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', '..', 'wasm', 'BUILD.json'),
    'utf8',
  ),
);

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>),
  );
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

test('the embedded payload decompresses to exactly the module BUILD.json records', async () => {
  expect(wasmGzipBase64).toHaveLength(build.payload.base64Characters);

  const gzipped = decode(new TextEncoder().encode(wasmGzipBase64));
  const stream = new Blob([gzipped as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());

  expect(bytes).toHaveLength(build.payload.wasmBytes);
  await expect(sha256(bytes)).resolves.toBe(build.payload.wasmSha256);
  // The WebAssembly preamble: "\0asm" then version 1.
  expect(Array.from(bytes.slice(0, 8))).toStrictEqual([
    0, 97, 115, 109, 1, 0, 0, 0,
  ]);
});

test('the limits the wrapper enforces are the ones the module was compiled with', () => {
  expect(MOPAC7_LIMITS).toStrictEqual({
    maxHeavyAtoms: build.limits.maxHeavyAtoms,
    maxHydrogenAtoms: build.limits.maxHydrogenAtoms,
    maxAtoms: build.limits.maxAtoms,
    maxOrbitals: build.limits.maxOrbitals,
  });
  // MOPAC derives all four from MAXHEV and MAXLIT in its SIZES file.
  expect(MOPAC7_LIMITS.maxAtoms).toBe(
    MOPAC7_LIMITS.maxHeavyAtoms + MOPAC7_LIMITS.maxHydrogenAtoms,
  );
  expect(MOPAC7_LIMITS.maxOrbitals).toBe(
    4 * MOPAC7_LIMITS.maxHeavyAtoms + MOPAC7_LIMITS.maxHydrogenAtoms,
  );
});

test('BUILD.json still names the pinned MOPAC 7.00 source', () => {
  expect(build.program.version).toBe('7.00');
  expect(build.source.commit).toBe('ed31531485fde27106e8e700fc8461b514923929');
  expect(build.source.treeSha256).toBe(
    'edaa50a6f0f581ea67241056f66c09e0919a6a922bacb4f57462d8ebdf55ee4c',
  );
});
