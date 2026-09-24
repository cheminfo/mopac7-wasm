/**
 * Make every f2c-emitted COMMON block as large as its largest declaration,
 * and fail the build if that cannot be done safely.
 *
 * WHY THIS EXISTS
 *   Fortran 77 lets each program unit declare a COMMON block with its own
 *   layout, and the block is as large as the largest declaration. f2c does not
 *   honour that: it emits one `struct { ... } name_;` per file, from that
 *   file's own view, and sizes the single definition (`<name>_com.c` under
 *   -ec) from just one of them -- not necessarily the largest. Any file that
 *   declared more then writes past the end of the object.
 *
 *   In MOPAC 7.00 this is not hypothetical. It is why a native build and a
 *   wasm build of the identical C disagree: the two linkers lay the blocks out
 *   differently, so the same overflow lands on different neighbours. Before
 *   the patches under patches/fortran, MNDO ethene came out at 273.90 kcal/mol
 *   in wasm and 15.99 kcal/mol natively.
 *
 *   f2c warns "incompatible lengths for common block x" for some of these and
 *   says nothing at all for others (a CHARACTER member left to the implicit
 *   rules, for instance), so the warning is not a usable check. Measuring
 *   sizeof on the emitted structs is.
 *
 * WHAT IT DOES
 *   1. reads every `struct {...} name_;` out of every .c in the directory;
 *   2. compiles one probe that prints sizeof for each, and runs it under node,
 *      so the sizes are the target's, not the host's;
 *   3. for a block whose definition is smaller than its largest declaration,
 *      appends one padding member to the DEFINITION and rewrites that file;
 *   4. re-measures and fails unless every block now fits.
 *
 *   Padding is only correct when the members that both views share sit at the
 *   same offsets -- i.e. when the short view is a prefix of the long one. A
 *   block whose members are at DIFFERENT offsets in different files is a real
 *   Fortran defect that has to be fixed in the Fortran (see
 *   patches/fortran/0006 and 0007); this script cannot see that, and says so.
 *
 * Usage: node scripts/check-commons.mjs --dir build/mopac7-c-O3 [--json FILE]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PAD_MEMBER = '__mopac7_wasm_common_pad';
const options = readOptions(process.argv.slice(2));
const directory = options.dir;
if (directory === undefined) throw new Error('--dir is required');

// `.common-probe.c` is this script's own scratch file; the build's own glob
// skips dotfiles too, so it never reaches the compiler either.
const files = readdirSync(directory).filter(
  (name) => name.endsWith('.c') && !name.startsWith('.'),
);
if (files.length === 0) throw new Error(`no .c files in ${directory}`);

const declarations = collectDeclarations(directory, files);
const before = measure(directory, declarations);
const padded = [];

for (const [block, perFile] of groupByBlock(declarations, before)) {
  const definition = perFile.find((entry) => entry.isDefinition);
  if (definition === undefined) continue;
  let largest = definition;
  for (const entry of perFile) if (entry.size > largest.size) largest = entry;
  if (largest.size <= definition.size) continue;
  if (/[=]\s*\{/.test(readFileSync(join(directory, definition.file), 'utf8'))) {
    throw new Error(
      `COMMON /${block}/ is defined with initialisers in ${definition.file} ` +
        `(${definition.size} bytes) but ${largest.file} declares ${largest.size}. ` +
        'Padding an initialised BLOCK DATA definition is not safe here: fix the ' +
        'Fortran with a patch under patches/fortran instead.',
    );
  }
  padDefinition(directory, definition, largest.size - definition.size);
  padded.push({
    block,
    definedIn: definition.file,
    was: definition.size,
    now: largest.size,
    largestDeclaredBy: largest.file,
  });
}

if (padded.length > 0) {
  const after = measure(directory, collectDeclarations(directory, files));
  for (const [block, perFile] of groupByBlock(
    collectDeclarations(directory, files),
    after,
  )) {
    const definition = perFile.find((entry) => entry.isDefinition);
    if (definition === undefined) continue;
    for (const entry of perFile) {
      if (entry.size > definition.size) {
        throw new Error(
          `COMMON /${block}/ is still too small after padding: ${definition.size} bytes ` +
            `in ${definition.file}, ${entry.size} declared by ${entry.file}`,
        );
      }
    }
  }
}

for (const entry of padded) {
  process.stdout.write(
    `    padded COMMON /${entry.block}/ ${entry.was} -> ${entry.now} bytes ` +
      `(${entry.largestDeclaredBy} declares the larger view)\n`,
  );
}
if (padded.length === 0) {
  process.stdout.write('    every COMMON block already fits\n');
}
if (options.json !== undefined) {
  writeFileSync(options.json, `${JSON.stringify(padded, null, 2)}\n`);
}

// Every `struct {...} name_;` at file scope, with the body verbatim.
function collectDeclarations(directory, files) {
  const pattern =
    /^(?:Extern )?struct \{\n(?<body>[\s\S]*?)\n\} (?<symbol>\w+_);/gm;
  const found = [];
  for (const file of files) {
    const text = readFileSync(join(directory, file), 'utf8');
    for (const match of text.matchAll(pattern)) {
      found.push({
        file,
        symbol: match.groups.symbol,
        body: match.groups.body,
        // f2c writes the one real definition without `Extern`; every user has it.
        isDefinition: !match[0].startsWith('Extern'),
      });
    }
  }
  return found;
}

// sizeof for every collected struct, measured by the target compiler and run
// under node -- a host measurement would be a different ABI.
function measure(directory, declarations) {
  const lines = ['#include "f2c.h"', '#include <stdio.h>'];
  for (const [index, entry] of declarations.entries()) {
    lines.push(`typedef struct {\n${entry.body}\n} probe${index};`);
  }
  lines.push('int main(void) {');
  for (const index of declarations.keys()) {
    lines.push(String.raw`  printf("%zu\n", sizeof(probe${index}));`);
  }
  lines.push('  return 0;\n}');
  const probeSource = join(directory, '.common-probe.c');
  const probeModule = join(directory, '.common-probe.cjs');
  writeFileSync(probeSource, `${lines.join('\n')}\n`);
  execFileSync(
    'emcc',
    ['-O0', `-I${directory}`, probeSource, '-o', probeModule],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  const output = execFileSync('node', [probeModule], { encoding: 'utf8' })
    .trim()
    .split('\n');
  if (output.length !== declarations.length) {
    throw new Error(
      `probe printed ${output.length} sizes for ${declarations.length} structs`,
    );
  }
  const sizes = new Array(output.length);
  for (let index = 0; index < output.length; index++) {
    sizes[index] = Number(output[index]);
  }
  return sizes;
}

function groupByBlock(declarations, sizes) {
  const blocks = new Map();
  for (let index = 0; index < declarations.length; index++) {
    const entry = declarations[index];
    const list = blocks.get(entry.symbol) ?? [];
    list.push({ ...entry, size: sizes[index] });
    blocks.set(entry.symbol, list);
  }
  return blocks;
}

function padDefinition(directory, definition, bytes) {
  const path = join(directory, definition.file);
  const text = readFileSync(path, 'utf8');
  const original = `struct {\n${definition.body}\n} ${definition.symbol};`;
  if (!text.includes(original)) {
    throw new Error(
      `cannot find the definition of ${definition.symbol} in ${definition.file}`,
    );
  }
  const replacement =
    `struct {\n${definition.body}\n` +
    `    /* Fortran sizes a COMMON block by its LARGEST declaration; f2c did not. */\n` +
    `    char ${PAD_MEMBER}[${bytes}];\n} ${definition.symbol};`;
  writeFileSync(path, text.replace(original, replacement));
}

function readOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (key === undefined || !key.startsWith('--')) {
      throw new Error(`expected an option, found ${String(key)}`);
    }
    options[key.slice(2)] = argv[index + 1];
  }
  return options;
}
