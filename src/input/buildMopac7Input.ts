import { Mopac7Error } from '../Mopac7Error.ts';
import { MOPAC7_LIMITS } from '../limits.ts';
import type { Mopac7Method, Mopac7Options } from '../types.ts';

import {
  MOPAC7_ELEMENTS,
  elementNumber,
  isElementSupported,
  isHydrogen,
} from './elements.ts';
import type { Point } from './geometry.ts';
import { geometryBlock, needsDummyAtom } from './geometry.ts';
import {
  MAX_KEYWORD_LINE,
  SPIN_KEYWORDS,
  checkExtraKeyword,
} from './keywords.ts';

/**
 * Turn a molecule and a set of options into a MOPAC 7 input deck. No
 * WebAssembly is involved, so this is also how a deck is inspected, stored or
 * handed to a native MOPAC.
 *
 * Everything MOPAC cannot report clearly is checked here first: an unknown
 * element symbol, an element the hamiltonian has no parameters for, a
 * coordinate count that does not match the elements, the array bounds the
 * binary was compiled with, and — through {@link checkExtraKeyword} — an extra
 * keyword that would shift the deck's own lines or produce a listing this
 * package cannot read.
 * @param options - The molecule and the calculation to run.
 * @returns The deck, ending in a newline.
 * @throws {Mopac7Error} With `code: 'input'` when the options cannot produce a valid deck.
 */
export function buildMopac7Input(options: Mopac7Options): string {
  const method = options.method ?? 'AM1';
  const positions = toPoints(options.coordinates, options.elements.length);
  validate(options.elements, positions, method);

  const keywords: string[] = [method];
  if (options.optimize !== true) keywords.push('1SCF');
  keywords.push('XYZ', 'VECTORS');
  if (options.allOrbitals !== false) keywords.push('ALLVEC', 'DEBUG');
  if (options.precise !== false) keywords.push('PRECISE');
  keywords.push('GEO-OK', `CHARGE=${options.charge ?? 0}`);
  const spin = SPIN_KEYWORDS[options.spin ?? 'singlet'];
  if (spin !== null) keywords.push(spin);
  for (const keyword of options.keywords ?? []) {
    keywords.push(checkExtraKeyword(keyword));
  }

  const line = keywords.join(' ');
  if (line.length > MAX_KEYWORD_LINE) {
    throw new Mopac7Error(
      'input',
      `the keyword line is ${line.length} characters; MOPAC 7 reads at most ${MAX_KEYWORD_LINE} on the first line`,
    );
  }

  const title = (options.title ?? 'mopac7-wasm')
    .replaceAll(/[\r\n]/g, ' ')
    .slice(0, 80);
  return `${line}\n${title}\n \n${geometryBlock(options.elements, positions)}\n`;
}

function toPoints(
  coordinates: Mopac7Options['coordinates'],
  atomCount: number,
): readonly Point[] {
  const points: Point[] = [];
  if (
    Array.isArray(coordinates) &&
    coordinates.length > 0 &&
    Array.isArray(coordinates[0])
  ) {
    const rows = coordinates as readonly number[][];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (row === undefined || row.length < 3) {
        throw new Mopac7Error(
          'input',
          `coordinates[${index}] does not hold three numbers`,
        );
      }
      points.push({
        x: row[0] as number,
        y: row[1] as number,
        z: row[2] as number,
      });
    }
    return assertLength(points, atomCount);
  }

  const flat = coordinates as ArrayLike<number>;
  if (flat.length % 3 !== 0) {
    throw new Mopac7Error(
      'input',
      `coordinates holds ${flat.length} numbers, which is not a multiple of three`,
    );
  }
  for (let index = 0; index < flat.length; index += 3) {
    points.push({
      x: flat[index] as number,
      y: flat[index + 1] as number,
      z: flat[index + 2] as number,
    });
  }
  return assertLength(points, atomCount);
}

function assertLength(
  points: readonly Point[],
  atomCount: number,
): readonly Point[] {
  if (points.length !== atomCount) {
    throw new Mopac7Error(
      'input',
      `there are ${atomCount} elements but ${points.length} sets of coordinates`,
    );
  }
  for (let index = 0; index < points.length; index++) {
    const point = points[index] as Point;
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(point.z)
    ) {
      throw new Mopac7Error(
        'input',
        `the coordinates of atom ${index} are not finite`,
      );
    }
  }
  return points;
}

function validate(
  elements: readonly string[],
  positions: readonly Point[],
  method: Mopac7Method,
): void {
  if (elements.length === 0) {
    throw new Mopac7Error('input', 'there are no atoms');
  }

  let heavy = 0;
  let hydrogen = 0;
  let orbitals = 0;
  for (const element of elements) {
    if (elementNumber(element) === null) {
      throw new Mopac7Error(
        'input',
        `"${element}" is not an element symbol MOPAC 7 knows`,
      );
    }
    if (!isElementSupported(element, method)) {
      throw new Mopac7Error(
        'input',
        `MOPAC 7 has no ${method} parameters for ${element}; ${method} covers ${describeSupported(method)}`,
      );
    }
    if (isHydrogen(element)) {
      hydrogen++;
      orbitals += 1;
    } else {
      heavy++;
      orbitals += 4;
    }
  }

  const atoms = elements.length + (needsDummyAtom(positions) ? 1 : 0);
  if (heavy > MOPAC7_LIMITS.maxHeavyAtoms) {
    throw new Mopac7Error(
      'input',
      `${heavy} non-hydrogen atoms, and this build of MOPAC 7 holds at most ${MOPAC7_LIMITS.maxHeavyAtoms}`,
    );
  }
  if (hydrogen > MOPAC7_LIMITS.maxHydrogenAtoms) {
    throw new Mopac7Error(
      'input',
      `${hydrogen} hydrogen atoms, and this build of MOPAC 7 holds at most ${MOPAC7_LIMITS.maxHydrogenAtoms}`,
    );
  }
  if (atoms > MOPAC7_LIMITS.maxAtoms) {
    throw new Mopac7Error(
      'input',
      `${atoms} atoms, and this build of MOPAC 7 holds at most ${MOPAC7_LIMITS.maxAtoms}`,
    );
  }
  if (orbitals > MOPAC7_LIMITS.maxOrbitals) {
    throw new Mopac7Error(
      'input',
      `${orbitals} atomic orbitals, and this build of MOPAC 7 holds at most ${MOPAC7_LIMITS.maxOrbitals}`,
    );
  }
}

function describeSupported(method: Mopac7Method): string {
  return MOPAC7_ELEMENTS[method].join(', ');
}
