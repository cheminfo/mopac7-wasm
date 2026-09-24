/**
 * Write wasm/BUILD.json: what was built, from what, and how large it came out.
 *
 * Called by scripts/build-wasm.sh as its last step. It is a node script rather
 * than more shell because the gzip and brotli figures come from node's own
 * zlib, so they are the numbers a bundler and an HTTP server will actually see.
 *
 * Usage: node scripts/write-build-json.mjs --out FILE --wasm FILE --glue FILE
 *          --opt O3 --emcc STRING --f2c 20240504 --mopac-commit SHA
 *          --mopac-tree-sha SHA --f2c-commit SHA --libf2c-sha SHA
 *          --dropped FILE --patches DIR
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const options = readOptions(process.argv.slice(2));
const wasm = readFileSync(options.wasm);
const glue = readFileSync(options.glue);
const both = Buffer.concat([wasm, glue]);

const build = {
  name: 'mopac7-wasm',
  builtAt: new Date().toISOString(),
  program: {
    name: 'MOPAC',
    version: '7.00',
    year: 1993,
    author: 'J. J. P. Stewart',
    distribution: 'QCPE #688',
    methods: ['MNDO', 'MINDO3', 'AM1', 'PM3'],
    license:
      'public domain (mopac.f: "a work of the United States Government and as such is not subject to protection by copyright", 17 U.S.C. 105); the openmopac/MOPAC-archive collection around it is BSD-3-Clause',
  },
  source: {
    repository: 'https://github.com/openmopac/MOPAC-archive',
    commit: options['mopac-commit'],
    subdirectory: '1993_MOPAC7',
    treeSha256: options['mopac-tree-sha'],
  },
  toolchain: {
    translator: `f2c ${options.f2c}`,
    translatorRepository: 'https://github.com/barak/f2c',
    translatorCommit: options['f2c-commit'],
    runtime: 'netlib libf2c.zip',
    runtimeSha256: options['libf2c-sha'],
    compiler: options.emcc,
    optimization: `-${options.opt}`,
  },
  patches: listPatches(options.patches),
  droppedCommonObjects: readDropped(options.dropped),
  artifacts: {
    'mopac7.wasm': measure(wasm),
    'mopac7.mjs': measure(glue),
    total: measure(both),
  },
  sha256: {
    'mopac7.wasm': await digest(wasm),
    'mopac7.mjs': await digest(glue),
  },
};

writeFileSync(options.out, `${JSON.stringify(build, null, 2)}\n`);

function measure(buffer) {
  return {
    raw: buffer.length,
    gzip: gzipSync(buffer, { level: 9 }).length,
    brotli: brotliCompressSync(buffer, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: buffer.length,
      },
    }).length,
  };
}

// Web Crypto, so this file stays free of node:crypto.
async function digest(buffer) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  let hex = '';
  for (let index = 0; index < hash.length; index++) {
    hex += hash[index].toString(16).padStart(2, '0');
  }
  return hex;
}

function readDropped(file) {
  const symbols = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.length === 0) continue;
    symbols.push(line.split(' ', 2)[1]);
  }
  return symbols;
}

function listPatches(directory) {
  const patches = [];
  for (const group of ['fortran', 'c']) {
    let entries;
    try {
      entries = readdirSync(join(directory, group));
    } catch {
      continue;
    }
    for (const entry of entries.toSorted()) {
      if (!entry.endsWith('.patch')) continue;
      const text = readFileSync(join(directory, group, entry), 'utf8');
      const subject =
        /^Subject:\s*(?<line>.+)$/m.exec(text)?.groups?.line ?? '';
      patches.push({ file: `patches/${group}/${entry}`, subject });
    }
  }
  patches.push({
    file: 'patches/shim.c',
    subject:
      'added translation unit: fdate_, myflsh_, and int-returning wrappers for libf2c s_copy / s_cat / getenv_',
  });
  return patches;
}

function readOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (key === undefined || !key.startsWith('--')) {
      throw new Error(`expected an option, found ${String(key)}`);
    }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${key} has no value`);
    options[key.slice(2)] = value;
  }
  for (const required of ['out', 'wasm', 'glue', 'opt', 'dropped', 'patches']) {
    if (options[required] === undefined) {
      throw new Error(`--${required} is required`);
    }
  }
  return options;
}
