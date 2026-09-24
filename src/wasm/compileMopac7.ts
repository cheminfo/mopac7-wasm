import { decode } from 'uint8-base64';

import { wasmGzipBase64 } from '../../wasm/data.js';

/**
 * Compile the embedded MOPAC 7 WebAssembly module.
 *
 * The binary lives inside the JavaScript, gzipped and base64-encoded, so there
 * is nothing to fetch and nothing to serve; decoding uses only Web Platform
 * APIs, so node and the browser take the same path. The result is cached, so
 * the payload is decoded and compiled once per JavaScript realm however many
 * calculations follow.
 *
 * A `WebAssembly.Module` is structured-cloneable, which makes this the worker
 * story as well: compile once on the main thread, `postMessage` the module to
 * every worker, and each one instantiates it in well under a millisecond.
 *
 * Only a success is cached. A failure — a realm without
 * `DecompressionStream`, a `WebAssembly.compile` that ran out of memory — is
 * forgotten again, so the next call retries instead of replaying the same
 * rejection for the lifetime of the realm.
 * @returns The compiled module, ready to instantiate.
 */
export function compileMopac7(): Promise<WebAssembly.Module> {
  if (compiled === undefined) {
    const pending = compile();
    compiled = pending;
    void pending.catch(() => {
      if (compiled === pending) compiled = undefined;
    });
  }
  return compiled;
}

let compiled: Promise<WebAssembly.Module> | undefined;

async function compile(): Promise<WebAssembly.Module> {
  const gzipped = decode(new TextEncoder().encode(wasmGzipBase64));
  const stream = new Blob([gzipped as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return WebAssembly.compile(await new Response(stream).arrayBuffer());
}
