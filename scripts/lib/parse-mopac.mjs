/**
 * Read the numbers this build is verified on out of a MOPAC 7 listing.
 *
 * Build-time only, and deliberately strict: it throws rather than return a
 * partial result, because a silently-empty parse would turn a broken build
 * into a passing verification. The published package gets a real parser.
 *
 * MOPAC 7 has no machine-readable output file (no .aux), so everything comes
 * from the printed listing. Two quirks the reader has to know:
 *
 *   with DEBUG, intermediate matrices are printed too, so the LAST
 *     `EIGENVECTORS` block is the converged one;
 *   symtrz.f prints debug noise on its own lines, which are dropped.
 */

/**
 * Read the verified numbers out of one MOPAC 7 listing.
 * @param {string} listing - The whole FOR006 text.
 * @returns {{version: string, pointGroup: string|null, occupiedCount: number,
 *   heatOfFormationKcal: number, ionizationPotentialEv: number,
 *   eigenvaluesEv: number[], symmetryLabels: string[]}} The parsed listing.
 */
export function parseMopacOutput(listing) {
  const lines = [];
  for (const line of listing.split('\n')) {
    if (line.includes('symtrz.f')) continue;
    lines.push(line);
  }
  const text = lines.join('\n');

  const version = /MOPAC:\s+VERSION\s+(?<value>[\d.]+)/.exec(text)?.groups
    ?.value;
  if (version === undefined) {
    throw new Error('no MOPAC version banner: the run produced no listing');
  }
  if (!text.includes('SCF FIELD WAS ACHIEVED')) {
    throw new Error('the SCF did not converge');
  }

  const occupied = /NO\. OF DOUBLY OCCUPIED LEVELS\s*=\s*(?<value>\d+)/.exec(
    text,
  )?.groups?.value;
  if (occupied === undefined) {
    throw new Error('no "NO. OF DOUBLY OCCUPIED LEVELS" line');
  }

  const heat = /FINAL HEAT OF FORMATION\s*=\s*(?<value>-?[\d.]+)/.exec(text)
    ?.groups?.value;
  if (heat === undefined) throw new Error('no "FINAL HEAT OF FORMATION" line');

  const potential = /IONIZATION POTENTIAL\s*=\s*(?<value>-?[\d.]+)/.exec(text)
    ?.groups?.value;
  if (potential === undefined) {
    throw new Error('no "IONIZATION POTENTIAL" line');
  }

  const { eigenvalues, labels } = readLastEigenvectorBlock(lines);
  if (eigenvalues.length < Number(occupied)) {
    throw new Error(
      `${eigenvalues.length} eigenvalues printed for ${occupied} occupied levels`,
    );
  }

  return {
    version,
    pointGroup:
      /MOLECULAR POINT GROUP\s*:\s*(?<value>\S+)/.exec(text)?.groups?.value ??
      null,
    occupiedCount: Number(occupied),
    heatOfFormationKcal: Number(heat),
    ionizationPotentialEv: Number(potential),
    eigenvaluesEv: eigenvalues,
    symmetryLabels: labels,
  };
}

// MOPAC prints eigenvectors in groups of up to eight roots: a `Root No.` line,
// then the symmetry labels, then the eigenvalues, then one row per AO.
function readLastEigenvectorBlock(lines) {
  let start = -1;
  for (let index = lines.length - 1; index >= 0; index--) {
    if (/\bEIGENVECTORS\s*$/.test(lines[index])) {
      start = index;
      break;
    }
  }
  if (start === -1) throw new Error('no EIGENVECTORS block in the listing');

  const roots = [];
  const eigenvalues = [];
  const labels = [];
  for (let index = start; index < lines.length; index++) {
    if (lines[index].includes('NET ATOMIC CHARGES')) break;
    const header = /^\s*Root No\.\s+(?<values>\d+(?:\s+\d+)*)\s*$/.exec(
      lines[index],
    );
    if (header === null) continue;
    const group = header.groups.values.trim().split(/\s+/);
    const values = lines[index + 4].trim().split(/\s+/);
    if (values.length !== group.length) {
      throw new Error(
        `root group of ${group.length} has ${values.length} eigenvalues`,
      );
    }
    for (const piece of lines[index + 2].trim().split(/\s{2,}/)) {
      labels.push(piece.replaceAll(' ', ''));
    }
    for (let k = 0; k < group.length; k++) {
      roots.push(Number(group[k]));
      eigenvalues.push(Number(values[k]));
    }
  }
  for (let index = 0; index < roots.length; index++) {
    if (roots[index] !== index + 1) {
      throw new Error(
        `roots are not numbered 1..n (position ${index} is root ${roots[index]}): ` +
          'MOPAC printed only a window of the spectrum, so the deck needs ALLVEC DEBUG',
      );
    }
  }
  return { eigenvalues, labels };
}
