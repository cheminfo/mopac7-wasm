import type { Mopac7AtomicOrbital } from '../types.ts';

import { FIELD_START } from './fields.ts';

/**
 * Read the label part of one coefficient row: orbital type, element symbol,
 * atom number.
 *
 * `matou1.f` writes the row as `FORMAT (1H ,2(1X,A2),I3,F8.4,10F8.4)`, so the
 * label is three fixed-width fields and not three whitespace-separated words:
 *
 *     column   1   2  3-4   5  6-7   8-10   11-18
 *     field   1H  1X   A2  1X   A2     I3   F8.4
 *              _   _  'S '  _  ' C'  '  1'  ' -.3780'
 *
 * The `I3` runs out of room at atom 100, and the space between the element and
 * the number is the first casualty:
 *
 *       S   C  1  -.0459 ...      atom 1
 *       S   H100  -.0061 ...      atom 100, no separator at all
 *
 * Reading this by splitting on whitespace therefore stops dead at the first
 * three-digit atom — which, for paclitaxel at 113 atoms, silently cost the
 * last 14 basis functions of every orbital. The columns never move, so they are
 * what is read.
 * @param line - The row, verbatim.
 * @returns The atomic orbital, or `null` when the line is not a coefficient row.
 */
export function readAtomicOrbital(line: string): Mopac7AtomicOrbital | null {
  const type = line.slice(TYPE_COLUMN, ELEMENT_COLUMN - 1).trim();
  const element = line.slice(ELEMENT_COLUMN, ATOM_COLUMN).trim();
  const atom = line.slice(ATOM_COLUMN, FIELD_START).trim();
  if (!AO_TYPE.test(type) || !AO_ELEMENT.test(element) || !AO_ATOM.test(atom)) {
    return null;
  }
  return { atomIndex: Number(atom) - 1, element, type };
}

/** 0-based start of `matou1.f`'s first `A2`, the orbital type. */
const TYPE_COLUMN = 2;
/** 0-based start of its second `A2`, the element symbol. */
const ELEMENT_COLUMN = 5;
/** 0-based start of its `I3`, the atom number, which ends at {@link FIELD_START}. */
const ATOM_COLUMN = 7;

/** `ATORBS` in `matou1.f`: `S `, `Px`, `Py`, `Pz`, `x2`, `xz`, `z2`, `yz`, `xy`. */
const AO_TYPE = /^[A-Za-z][A-Za-z\d]?$/;
/** `ELEMNT`, one or two letters. */
const AO_ELEMENT = /^[A-Za-z]{1,2}$/;
/** The `I3` field, which Fortran fills with `***` rather than overflow. */
const AO_ATOM = /^\d{1,3}$/;
