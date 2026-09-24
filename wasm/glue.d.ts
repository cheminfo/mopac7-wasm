// Declarations for wasm/glue.js, the emscripten factory `npm run build-wasm`
// writes next to this file.
//
// Hand-written rather than generated: emscripten emits no declarations, and the
// members below are the whole surface the package uses. They match the link
// flags in scripts/build-wasm.sh, which export exactly callMain, FS, ENV and
// _fflush.

/** Emscripten's in-memory filesystem, as far as this package uses it. */
export interface Mopac7FileSystem {
  /** Write a file into MEMFS, creating it if needed. */
  writeFile: (path: string, data: string | Uint8Array) => void;
  /** Read a file back out of MEMFS. Throws when the path does not exist. */
  readFile: (path: string) => Uint8Array;
}

/** The runtime object a `preRun` callback receives, and the instantiated module. */
export interface Mopac7Runtime {
  /** MEMFS. MOPAC is a file-in/file-out program, so the deck is written here. */
  FS: Mopac7FileSystem;
  /**
   * The process environment MOPAC reads its unit numbers from. It must be
   * written inside `preRun`: libf2c captures it when the runtime starts, so
   * assigning after instantiation is too late.
   */
  ENV: Record<string, string>;
  /** Run MOPAC's `main`. Runs once per instance; a second call aborts. */
  callMain: (args: string[]) => number;
  /**
   * C `fflush`. MOPAC writes its listing through a buffered `FILE*`, and with
   * `EXIT_RUNTIME` off nothing flushes it when `main` returns, so the listing
   * is silently truncated at the last buffer boundary. Call `_fflush(0)` after
   * `callMain` and before reading the file.
   */
  _fflush: (stream: number) => number;
}

/** The options this package passes to the Emscripten factory. */
export interface Mopac7ModuleOptions {
  /**
   * Emscripten's hook for supplying an already compiled module, so the 789 kB
   * binary is compiled once per realm instead of once per calculation.
   */
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    onSuccess: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
  ) => Record<string, never>;
  /** Called once per line MOPAC writes to stdout. */
  print?: (line: string) => void;
  /** Called once per line MOPAC writes to stderr. */
  printErr?: (line: string) => void;
  /** Callbacks run after the runtime exists and before `main`. */
  preRun?: Array<(runtime: Mopac7Runtime) => void>;
}

declare const factory: (options?: Mopac7ModuleOptions) => Promise<Mopac7Runtime>;
export default factory;
