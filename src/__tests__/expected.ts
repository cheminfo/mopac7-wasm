/**
 * The numbers every run has to reproduce.
 *
 * They come from `verification/reference-mopac7.json`, which records a run of
 * the same three methods over the same fourteen molecules made with a DIFFERENT
 * release of MOPAC 7 — the Ghemical packaging of MOPAC 7.01 — under the
 * identical keyword line
 * `<METHOD> 1SCF XYZ VECTORS ALLVEC DEBUG PRECISE GEO-OK CHARGE=0`. This
 * repository builds MOPAC 7.00 from openmopac/MOPAC-archive, so these literals
 * are an independent check rather than a recording of this build's own output:
 * `scripts/verify.mjs` reports the worst difference over all 42 decks and 306
 * occupied levels as 0.000000 eV.
 *
 * MOPAC prints orbital energies to three decimals and the heat of formation to
 * five, so the assertions are exact. Regenerate rather than edit by hand.
 */
import type { MoleculeName } from './molecules.ts';

/** What MOPAC has to report for one molecule under one hamiltonian. */
export interface ReferenceValues {
  heatOfFormation: number;
  ionizationPotential: number;
  pointGroup: string;
  basisSize: number;
  filledLevels: number;
  symmetryLabels: string[];
  occupiedEnergies: number[];
}

export const EXPECTED: Record<
  MoleculeName,
  Record<'AM1' | 'PM3' | 'MNDO', ReferenceValues>
> = {
  water: {
    AM1: {
      heatOfFormation: -59.17072,
      ionizationPotential: 12.44576,
      pointGroup: 'C2V',
      basisSize: 6,
      filledLevels: 4,
      symmetryLabels: ['1A1', '1B2', '2A1', '1B1'],
      occupiedEnergies: [-36.288, -18.143, -14.906, -12.446],
    },
    PM3: {
      heatOfFormation: -52.89956,
      ionizationPotential: 12.32747,
      pointGroup: 'C2V',
      basisSize: 6,
      filledLevels: 4,
      symmetryLabels: ['1A1', '1B2', '2A1', '1B1'],
      occupiedEnergies: [-36.517, -17.307, -14.691, -12.327],
    },
    MNDO: {
      heatOfFormation: -60.00702,
      ionizationPotential: 12.17985,
      pointGroup: 'C2V',
      basisSize: 6,
      filledLevels: 4,
      symmetryLabels: ['1A1', '1B2', '2A1', '1B1'],
      occupiedEnergies: [-39.585, -18.653, -14.581, -12.18],
    },
  },
  benzene: {
    AM1: {
      heatOfFormation: 22.44044,
      ionizationPotential: 9.66942,
      pointGroup: 'D6H',
      basisSize: 30,
      filledLevels: 15,
      symmetryLabels: [
        '1A1G',
        '1E1U',
        '1E1U',
        '1E2G',
        '1E2G',
        '2A1G',
        '1B2U',
        '1B1U',
        '2E1U',
        '2E1U',
        '1A2U',
        '2E2G',
        '2E2G',
        '1E1G',
        '1E1G',
      ],
      occupiedEnergies: [
        -39.231, -31.459, -31.459, -23.14, -23.14, -17.936, -16.224, -15.419,
        -14.21, -14.21, -13.399, -11.929, -11.929, -9.669, -9.669,
      ],
    },
    PM3: {
      heatOfFormation: 23.66029,
      ionizationPotential: 9.73327,
      pointGroup: 'D6H',
      basisSize: 30,
      filledLevels: 15,
      symmetryLabels: [
        '1A1G',
        '1E1U',
        '1E1U',
        '1E2G',
        '1E2G',
        '2A1G',
        '1B1U',
        '1B2U',
        '2E1U',
        '2E1U',
        '1A2U',
        '2E2G',
        '2E2G',
        '1E1G',
        '1E1G',
      ],
      occupiedEnergies: [
        -39.339, -29.595, -29.595, -21.439, -21.439, -18.505, -16.261, -15.225,
        -14.649, -14.649, -13.192, -12.4, -12.4, -9.733, -9.733,
      ],
    },
    MNDO: {
      heatOfFormation: 22.0562,
      ionizationPotential: 9.46872,
      pointGroup: 'D6H',
      basisSize: 30,
      filledLevels: 15,
      symmetryLabels: [
        '1A1G',
        '1E1U',
        '1E1U',
        '1E2G',
        '1E2G',
        '2A1G',
        '1B2U',
        '1B1U',
        '2E1U',
        '2E1U',
        '1A2U',
        '2E2G',
        '2E2G',
        '1E1G',
        '1E1G',
      ],
      occupiedEnergies: [
        -42.74, -33.174, -33.174, -23.345, -23.345, -17.649, -16.74, -15.304,
        -14.496, -14.496, -12.758, -12.495, -12.495, -9.469, -9.469,
      ],
    },
  },
  pyridine: {
    AM1: {
      heatOfFormation: 33.36805,
      ionizationPotential: 10.08685,
      pointGroup: 'C2V',
      basisSize: 29,
      filledLevels: 15,
      symmetryLabels: [
        '1A1',
        '2A1',
        '1B2',
        '3A1',
        '2B2',
        '4A1',
        '3B2',
        '5A1',
        '4B2',
        '1B1',
        '6A1',
        '5B2',
        '7A1',
        '2B1',
        '1A2',
      ],
      occupiedEnergies: [
        -40.27, -33.184, -31.855, -24.319, -24.073, -18.138, -16.764, -16.648,
        -14.576, -14.458, -13.946, -12.553, -10.723, -10.723, -10.087,
      ],
    },
    PM3: {
      heatOfFormation: 31.27814,
      ionizationPotential: 10.18137,
      pointGroup: 'C2V',
      basisSize: 29,
      filledLevels: 15,
      symmetryLabels: [
        '1A1',
        '1B2',
        '2A1',
        '2B2',
        '3A1',
        '4A1',
        '3B2',
        '5A1',
        '4B2',
        '1B1',
        '6A1',
        '5B2',
        '2B1',
        '7A1',
        '1A2',
      ],
      occupiedEnergies: [
        -39.136, -29.903, -29.243, -22.135, -21.81, -18.475, -17.283, -15.688,
        -15.012, -13.982, -13.977, -12.897, -10.585, -10.335, -10.181,
      ],
    },
    MNDO: {
      heatOfFormation: 30.42799,
      ionizationPotential: 9.8614,
      pointGroup: 'C2V',
      basisSize: 29,
      filledLevels: 15,
      symmetryLabels: [
        '1A1',
        '2A1',
        '1B2',
        '3A1',
        '2B2',
        '4A1',
        '5A1',
        '3B2',
        '4B2',
        '6A1',
        '1B1',
        '5B2',
        '7A1',
        '2B1',
        '1A2',
      ],
      occupiedEnergies: [
        -43.188, -34.304, -33.584, -24.408, -24.338, -17.97, -17.033, -16.803,
        -14.847, -14.257, -13.947, -13.14, -11.04, -10.582, -9.861,
      ],
    },
  },
};
