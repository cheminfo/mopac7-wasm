/** The NDDO (or, for `MINDO3`, INDO) hamiltonian MOPAC 7 should use. */
export type Mopac7Method = 'MNDO' | 'MINDO3' | 'AM1' | 'PM3';

/** Spin state, written into the deck as MOPAC's own `SINGLET` … `SEXTET` keyword. */
export type Mopac7Spin =
  'singlet' | 'doublet' | 'triplet' | 'quartet' | 'quintet' | 'sextet';

/** What went wrong, for `Mopac7Error.code`. */
export type Mopac7ErrorCode =
  /** The options are wrong before MOPAC is even started: unknown element, bad coordinate count, over the built-in size limit. */
  | 'input'
  /** MOPAC rejected the keyword line: a word it does not know, two that conflict, or one it demanded and did not get. */
  | 'keywords'
  /** MOPAC rejected the geometry (`GEOMETRY IS FAULTY`, collinear first three atoms, …). */
  | 'geometry'
  /** The hamiltonian has no parameters for one of the elements. */
  | 'parameters'
  /** The molecule is past an array bound the binary was compiled with, and MOPAC said so itself. */
  | 'limits'
  /** The SCF did not converge. */
  | 'scf'
  /** MOPAC stopped for a reason it stated in the listing that is none of the above; the message quotes it. */
  | 'halt'
  /** The WebAssembly module trapped, or `main` threw. */
  | 'aborted'
  /** The run finished but the listing lacks a block the result needs, or does not add up. */
  | 'parse';

/**
 * MOPAC 7's molecular-mechanics correction to the peptide (`-HNCO-`) torsion,
 * as its own two keywords.
 *
 * `moldat.f` searches the geometry for `H-N-C=O` groups and **stops** on the
 * first one it finds unless the deck names one of these two, so every deck this
 * package builds carries one.
 *
 * - `'mmok'` writes `MMOK`, which adds `HTYPE * sin²(H-N-C=O)` per torsion to
 *   the heat of formation and to the Cartesian gradient (`compfg.f`,
 *   `dcart.f`), with `HTYPE` 6.1737 kcal/mol for MNDO, 3.3191 for AM1, 7.1853
 *   for PM3 and 1.7712 for MINDO/3. It is zero for a planar amide and largest
 *   for a twisted one, which is the rotation barrier NDDO underestimates.
 * - `'nomm'` writes `NOMM`, which leaves the heat of formation alone.
 *
 * The term is added **after** the SCF and never enters the Fock matrix, so the
 * choice moves {@link Mopac7Result.heatOfFormation} and nothing else: over
 * formamide, acetamide, N-methylacetamide, glycylglycine and benzene at AM1,
 * every orbital energy, every coefficient and every Mulliken charge comes back
 * identical under the two.
 */
export type Mopac7AmideCorrection = 'mmok' | 'nomm';

/** A molecule and the calculation to run on it. */
export interface Mopac7Options {
  /** Element symbols, one per atom, e.g. `['O', 'H', 'H']`. Case-insensitive. */
  elements: readonly string[];
  /**
   * Cartesian coordinates in ångström, in `elements` order: either one
   * `[x, y, z]` per atom, or a flat sequence of `3 * elements.length` numbers.
   */
  coordinates: readonly number[] | readonly number[][] | Float64Array;
  /**
   * The hamiltonian.
   * @default 'AM1'
   */
  method?: Mopac7Method;
  /**
   * Net charge on the system.
   * @default 0
   */
  charge?: number;
  /**
   * Spin state. Anything but `'singlet'` writes MOPAC's multiplicity keyword,
   * and MOPAC 7 then runs its RHF half-electron treatment. There is no
   * unrestricted option: `'UHF'` in {@link Mopac7Options.keywords} is refused,
   * because its listing has separate alpha and beta eigenvectors and
   * {@link Mopac7Result} holds one set.
   * @default 'singlet'
   */
  spin?: Mopac7Spin;
  /**
   * Optimise the geometry instead of running a single point. When `false` the
   * deck carries `1SCF`.
   * @default false
   */
  optimize?: boolean;
  /**
   * Print every molecular orbital instead of a window around the HOMO. Adds
   * `ALLVEC`, which is what makes {@link Mopac7Result.coefficients} complete.
   * @default true
   */
  allOrbitals?: boolean;
  /**
   * Which of MOPAC 7's two peptide keywords the deck carries. One of them is
   * always written, because MOPAC stops on any molecule holding an `-HNCO-`
   * group when the deck names neither — so without this every amide, peptide
   * and most drugs would fail.
   *
   * `'mmok'` is the default because it is the correction MOPAC itself asks for
   * (its `NOMM` branch prints "IF YOU WANT MM CORRECTION TO THE CONH BARRIER,
   * ADD THE KEY-WORD MMOK"), and because it is what the keyword exists to fix:
   * on a rigid AM1 torsion scan of N-methylacetamide the rotation barrier is
   * 13.18 kcal/mol under `NOMM` and 19.42 under `MMOK`, against an experimental
   * amide barrier near 16–22. It costs nothing anywhere else — see
   * {@link Mopac7AmideCorrection}.
   * @default 'mmok'
   */
  amideCorrection?: Mopac7AmideCorrection;
  /**
   * Tighten MOPAC's SCF and gradient criteria (`PRECISE`).
   * @default true
   */
  precise?: boolean;
  /**
   * Extra MOPAC keywords, appended to the first line of the deck, one array
   * entry per keyword. Each is checked first: whitespace, `+`, `SETUP` and
   * `UHF` are refused with `code: 'input'`, because they would shift the deck's
   * own lines or produce a listing this package cannot read.
   * @default []
   */
  keywords?: readonly string[];
  /**
   * The second line of the deck, which MOPAC echoes back in the listing.
   * @default 'mopac7-wasm'
   */
  title?: string;
}

/** One molecular orbital, as MOPAC printed it. */
export interface Mopac7Orbital {
  /** 0-based position in ascending energy. */
  index: number;
  /** Orbital energy in eV. MOPAC prints three decimals. */
  energy: number;
  /** `2` for a doubly occupied level, `0` for a virtual one. */
  occupancy: number;
  /** The symmetry label MOPAC printed above the root, e.g. `'1B1'`, or `null` when it printed none. */
  symmetry: string | null;
}

/** One atomic orbital: a row of {@link Mopac7Result.coefficients}. */
export interface Mopac7AtomicOrbital {
  /** 0-based index into {@link Mopac7Result.elements} and `coordinates`. */
  atomIndex: number;
  /** The element symbol MOPAC printed for that atom. */
  element: string;
  /** MOPAC's own orbital label: `'S'`, `'Px'`, `'Py'`, `'Pz'`, `'Dx2'`, `'Dxz'`, `'Dz2'`, `'Dyz'` or `'Dxy'`. */
  type: string;
}

/** The dipole moment in debye, as MOPAC's `SUM` row reports it. */
export interface Mopac7Dipole {
  x: number;
  y: number;
  z: number;
  total: number;
}

/** Everything the parser reads out of one MOPAC 7 listing. */
export interface Mopac7Result {
  /** MOPAC's own version string, read from the banner, e.g. `'7.00'`. */
  version: string;
  /** `true` when the listing carries `SCF FIELD WAS ACHIEVED`. */
  converged: boolean;
  /** MOPAC's geometry verdict, e.g. `'1SCF WAS SPECIFIED, SO BFGS WAS NOT USED'`, or `null`. */
  terminationMessage: string | null;

  /** Final heat of formation in kcal/mol. */
  heatOfFormation: number;
  /** Total energy in eV. */
  totalEnergy: number;
  /** Electronic energy in eV. */
  electronicEnergy: number;
  /** Core–core repulsion in eV. */
  coreCoreRepulsion: number;
  /** Koopmans ionisation potential in eV, which is MOPAC's negated HOMO energy. */
  ionizationPotential: number;
  /** Molecular weight, as MOPAC computes it. */
  molecularWeight: number;
  /** MOPAC's `NO. OF FILLED LEVELS`: the number of doubly occupied orbitals. */
  filledLevels: number;
  /** The molecular point group MOPAC assigned, e.g. `'D6H'`, or `null`. */
  pointGroup: string | null;

  /** One entry per printed molecular orbital, in ascending energy. */
  orbitals: Mopac7Orbital[];
  /** The atomic orbital basis, in the row order of `coefficients`. */
  basis: Mopac7AtomicOrbital[];
  /**
   * MO coefficients, orbital-major: the coefficient of atomic orbital `ao` in
   * molecular orbital `mo` is `coefficients[mo * basis.length + ao]`. MOPAC
   * prints four decimals, and the vectors are orthonormal in the ZDO sense.
   *
   * The phases are this package's, not the listing's. An eigenvector is only
   * defined up to its sign, and two builds of the same MOPAC print different
   * signs for the same orbital, so every column is turned so that **its
   * largest-magnitude coefficient is positive** — ties broken by the earliest
   * atomic orbital. A phase read from here is therefore stable across builds,
   * which is what colouring an orbital lobe by phase needs.
   */
  coefficients: Float64Array;

  /** Mulliken net atomic charge per atom. */
  charges: Float64Array;
  /** Total electron density per atom, as MOPAC prints it beside the charges. */
  electronDensities: Float64Array;
  /** The dipole moment, or `null` when MOPAC printed no dipole block. */
  dipole: Mopac7Dipole | null;

  /**
   * Element symbols in MOPAC's own atom order, with dummy atoms removed. This
   * is the order `basis`, `charges` and `coordinates` use.
   */
  elements: string[];
  /**
   * MOPAC's own Cartesian coordinates in ångström, flat, three per atom.
   * MOPAC rebuilds the geometry through internal coordinates, so this frame is
   * not the one that was handed in.
   */
  coordinates: Float64Array;

  /** MOPAC's self-reported `COMPUTATION TIME` in seconds. Always `0` here: the wasm build has no working CPU clock. */
  computationTimeSeconds: number;
  /**
   * Keywords MOPAC did not recognise and let through because `DEBUG` was set.
   * The decks this package builds do not carry `DEBUG`, so this is empty unless
   * the caller put it in {@link Mopac7Options.keywords} — without it MOPAC
   * stops on a keyword it does not know, and the call throws with
   * `code: 'keywords'` instead.
   */
  unknownKeywords: string[];
}

/** One raw MOPAC run: the deck that went in and the listing that came out. */
export interface Mopac7Job {
  /** The `.dat` deck that was written to the module's filesystem. */
  input: string;
  /** The listing MOPAC produced, verbatim. */
  listing: string;
  /** Lines MOPAC wrote to stderr. `symtrz.f` prints debug noise here. */
  diagnostics: string;
  /** What `main` returned, or `null` when it threw. */
  exitCode: number | null;
}
