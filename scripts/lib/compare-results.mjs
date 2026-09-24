/**
 * Compare two parsed MOPAC 7 results field by field.
 *
 * Both sides are `Mopac7Result` objects from `src/output/parseMopac7Output.ts`,
 * so the eigenvector phases have already been pinned by the package's own
 * convention and a difference here is a real one rather than an arbitrary sign.
 *
 * `result-fields.mjs` next door holds the tolerance of each block and the
 * arithmetic; what is here is which blocks are compared, and which differences
 * are a failure.
 *
 * What is reported as a note rather than a failure, and why: inside a set of
 * orbitals that share an energy, the individual vectors are only defined up to a
 * rotation of the set, so no convention pins them and two builds may
 * legitimately print different mixtures. The same goes for the symmetry label
 * `symtrz.f` assigns to such a root, and for a vector of the set that comes out
 * empty. Everything outside a degenerate set is a failure.
 */

import {
  TOLERANCES,
  differences,
  dipoleDifferences,
  record,
} from './result-fields.mjs';

/** A printed eigenvector is normalised, so anything this small is no vector. */
const MIN_COLUMN_NORM = 0.5;

/**
 * Compare two results.
 * @param {object} got - The result under test.
 * @param {object} want - The result it has to match.
 * @returns {{ok: boolean, fields: object, problems: string[], notes: string[]}}
 *   Per-field worst differences, a line per block outside its tolerance or of
 *   the wrong shape, and a line per difference that is confined to a degenerate
 *   orbital set.
 */
export function compareResults(got, want) {
  const problems = [];
  const notes = [];
  const fields = {};
  const degenerate = degenerateOrbitals(got);

  for (const name of [
    'heatOfFormation',
    'ionizationPotential',
    'totalEnergy',
    'electronicEnergy',
    'coreCoreRepulsion',
  ]) {
    record(fields, problems, name, [Math.abs(got[name] - want[name])], [0]);
  }
  for (const name of ['pointGroup', 'filledLevels']) {
    if (got[name] !== want[name]) {
      problems.push(
        `${name}: got ${String(got[name])}, want ${String(want[name])}`,
      );
    }
  }
  if (got.elements.join(' ') !== want.elements.join(' ')) {
    problems.push(
      `elements: got ${got.elements.join(' ')}, want ${want.elements.join(' ')}`,
    );
  }
  if (labelsOf(got.basis) !== labelsOf(want.basis)) {
    problems.push('basis: the atomic orbital order differs');
  }
  compareSymmetry(got, want, degenerate, problems, notes);

  record(
    fields,
    problems,
    'orbitalEnergies',
    differences(energiesOf(got), energiesOf(want)),
    energiesOf(got),
  );
  for (const name of ['charges', 'electronDensities', 'coordinates']) {
    record(
      fields,
      problems,
      name,
      differences(got[name], want[name]),
      got[name],
    );
  }
  record(
    fields,
    problems,
    'dipole',
    dipoleDifferences(got.dipole, want.dipole),
    [0],
  );

  const split = coefficientDifferences(got, want, degenerate);

  record(fields, problems, 'coefficients', split.plain, split.plainValues);
  fields.degenerateCoefficients = {
    worst: split.worstDegenerate,
    tolerance: Number.POSITIVE_INFINITY,
    count: split.degenerateCount,
    ok: true,
  };
  if (split.worstDegenerate > (TOLERANCES.coefficients ?? 0)) {
    notes.push(
      `degenerate coefficients differ by up to ${split.worstDegenerate.toExponential(3)} ` +
        `over ${split.degenerateCount} values: the mixture inside a degenerate set is arbitrary`,
    );
  }
  reportEmptyColumns(got, degenerate, problems, notes);

  return { ok: problems.length === 0, fields, problems, notes };
}

// Every orbital that shares its printed energy with another one.
function degenerateOrbitals(result) {
  const counts = new Map();
  for (const orbital of result.orbitals) {
    counts.set(orbital.energy, (counts.get(orbital.energy) ?? 0) + 1);
  }
  const flags = new Array(result.orbitals.length);
  for (let mo = 0; mo < result.orbitals.length; mo++) {
    flags[mo] = (counts.get(result.orbitals[mo].energy) ?? 0) > 1;
  }
  return flags;
}

function compareSymmetry(got, want, degenerate, problems, notes) {
  const count = Math.min(got.orbitals.length, want.orbitals.length);
  const differing = [];
  for (let mo = 0; mo < count; mo++) {
    if (got.orbitals[mo].symmetry !== want.orbitals[mo].symmetry) {
      differing.push(mo);
    }
  }
  if (differing.length === 0) return;
  const outside = differing.filter((mo) => !degenerate[mo]);
  const describe = differing
    .map(
      (mo) =>
        `root ${mo + 1} ${String(got.orbitals[mo].symmetry)}/${String(want.orbitals[mo].symmetry)}`,
    )
    .join(', ');
  if (outside.length > 0) {
    problems.push(
      `symmetry labels differ outside a degenerate set: ${describe}`,
    );
  } else {
    notes.push(`symmetry labels of a degenerate set differ: ${describe}`);
  }
}

function reportEmptyColumns(result, degenerate, problems, notes) {
  const size = result.basis.length;
  for (let mo = 0; mo < result.orbitals.length; mo++) {
    let sum = 0;
    for (let ao = 0; ao < size; ao++) {
      const value = result.coefficients[mo * size + ao];
      sum += value * value;
    }
    if (Math.sqrt(sum) >= MIN_COLUMN_NORM) continue;
    const line = `root ${mo + 1} (${result.orbitals[mo].energy} eV) has no eigenvector: its coefficients are all zero`;
    if (degenerate[mo]) notes.push(line);
    else problems.push(line);
  }
}

function energiesOf(result) {
  const values = new Array(result.orbitals.length);
  for (let mo = 0; mo < result.orbitals.length; mo++) {
    values[mo] = result.orbitals[mo].energy;
  }
  return values;
}

function coefficientDifferences(got, want, degenerate) {
  const plain = [];
  const plainValues = [];
  let worstDegenerate = 0;
  let degenerateCount = 0;
  if (got.coefficients.length !== want.coefficients.length) {
    return {
      plain: [Number.POSITIVE_INFINITY],
      plainValues: [0],
      worstDegenerate,
      degenerateCount,
    };
  }
  const size = got.basis.length;
  for (let mo = 0; mo < got.orbitals.length; mo++) {
    for (let ao = 0; ao < size; ao++) {
      const index = mo * size + ao;
      const difference = Math.abs(
        got.coefficients[index] - want.coefficients[index],
      );
      if (degenerate[mo]) {
        degenerateCount++;
        if (difference > worstDegenerate) worstDegenerate = difference;
      } else {
        plain.push(difference);
        plainValues.push(got.coefficients[index]);
      }
    }
  }
  if (plain.length === 0) {
    plain.push(0);
    plainValues.push(0);
  }
  return { plain, plainValues, worstDegenerate, degenerateCount };
}

function labelsOf(basis) {
  const parts = new Array(basis.length);
  for (let index = 0; index < basis.length; index++) {
    parts[index] =
      `${basis[index].element}${basis[index].atomIndex}${basis[index].type}`;
  }
  return parts.join(' ');
}
