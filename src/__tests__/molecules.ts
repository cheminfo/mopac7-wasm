/**
 * The molecules the test suite runs.
 *
 * {@link MOLECULES} comes from the cheminfo lcao photoelectron reference set
 * (OpenChemLib conformer + MMFF94, seed 16), which is also what the decks under
 * `verification/` carry verbatim, and what `verification/reference-mopac7.json`
 * holds the independent numbers for. Regenerate rather than edit by hand.
 *
 * {@link EXTRA_MOLECULES} is not from that set: four are small idealised
 * geometries written here, so that the option-coverage tests have an open shell,
 * an anion and a degenerate spectrum to run on, and each carries the bond length
 * it was built at. Formamide is the fifth: it is lcao's own library entry
 * (`NC=O`, seed 26) through the same OpenChemLib + MMFF94 pipeline, and it is
 * here because it is the smallest molecule MOPAC 7 refuses without MMOK or NOMM.
 */

/** The molecules of the lcao reference set this suite covers. */
export type MoleculeName = 'water' | 'benzene' | 'pyridine';

/** The idealised geometries the option-coverage tests add. */
export type ExtraMoleculeName =
  'methyl' | 'methane' | 'hydroxide' | 'dioxygen' | 'formamide';

/** A molecule in the reference set. */
export interface ReferenceMolecule {
  elements: string[];
  coordinates: number[][];
}

export const MOLECULES: Record<MoleculeName, ReferenceMolecule> = {
  water: {
    elements: ['O', 'H', 'H'],
    coordinates: [
      [0, 0.066772, 0],
      [0.763466, -0.529952, 0],
      [-0.763466, -0.529952, 0],
    ],
  },
  benzene: {
    elements: ['C', 'C', 'C', 'C', 'C', 'C', 'H', 'H', 'H', 'H', 'H', 'H'],
    coordinates: [
      [1.353699, -0.336211, 0],
      [0.968017, 1.004232, 0],
      [-0.385682, 1.340443, 0],
      [-1.353699, 0.336211, 0],
      [-0.968017, -1.004232, 0],
      [0.385682, -1.340443, 0],
      [2.408387, -0.598158, 0],
      [1.722214, 1.786644, 0],
      [-0.686173, 2.384803, 0],
      [-2.408386, 0.598159, 0],
      [-1.722214, -1.786645, 0],
      [0.686173, -2.384803, 0],
    ],
  },
  pyridine: {
    elements: ['C', 'C', 'C', 'N', 'C', 'C', 'H', 'H', 'H', 'H', 'H'],
    coordinates: [
      [0, -1.401837, 0],
      [-1.200441, -0.699184, 0],
      [-1.149481, 0.685686, 0],
      [0, 1.395343, 0],
      [1.149481, 0.685686, 0],
      [1.200441, -0.699184, 0],
      [0, -2.487964, 0],
      [-2.15269, -1.217125, 0],
      [-2.059195, 1.279093, 0],
      [2.059195, 1.279093, 0],
      [2.15269, -1.217125, 0],
    ],
  },
};

export const EXTRA_MOLECULES: Record<ExtraMoleculeName, ReferenceMolecule> = {
  // Planar D3H radical, r(CH) = 1.078 A: seven electrons, so an open shell.
  methyl: {
    elements: ['C', 'H', 'H', 'H'],
    coordinates: [
      [0, 0, 0],
      [1.078, 0, 0],
      [-0.539, 0.933, 0],
      [-0.539, -0.933, 0],
    ],
  },
  // An ideal tetrahedron, r(CH) = 1.0897 A: TD, with a threefold degenerate HOMO.
  methane: {
    elements: ['C', 'H', 'H', 'H', 'H'],
    coordinates: [
      [0, 0, 0],
      [0.629118, 0.629118, 0.629118],
      [-0.629118, -0.629118, 0.629118],
      [-0.629118, 0.629118, -0.629118],
      [0.629118, -0.629118, -0.629118],
    ],
  },
  // r(OH) = 0.96 A. Needs charge -1 to be a closed shell.
  hydroxide: {
    elements: ['O', 'H'],
    coordinates: [
      [0, 0, 0],
      [0.96, 0, 0],
    ],
  },
  // r(OO) = 1.216 A, the experimental bond length. Its ground state is a triplet.
  dioxygen: {
    elements: ['O', 'O'],
    coordinates: [
      [0, 0, 0],
      [1.216, 0, 0],
    ],
  },
  // lcao's own library entry for `NC=O` at seed 26: one H-N-C=O group, which is
  // what moldat.f stops on.
  formamide: {
    elements: ['N', 'C', 'O', 'H', 'H', 'H'],
    coordinates: [
      [0.147505, -0.003541, 0.676848],
      [-0.136278, 0.018612, -0.65176],
      [-0.625743, -0.927637, -1.247767],
      [-0.058703, -0.848225, 1.193987],
      [0.552485, 0.784513, 1.161155],
      [0.120734, 0.976278, -1.132462],
    ],
  },
};
