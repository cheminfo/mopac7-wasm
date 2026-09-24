/** One atom's cartesian position in ångström. */
export interface Point {
  x: number;
  y: number;
  z: number;
}

/**
 * Write the geometry rows of a MOPAC 7 deck, working around two hard
 * behaviours of its `getgeo.f` that no keyword can switch off:
 *
 *   a geometry of three atoms or fewer is ALWAYS read as internal
 *     coordinates, whatever `XYZ` says, so one to three atoms are emitted as a
 *     Z-matrix built from the cartesians;
 *   the first three atoms must not be collinear — `getgeo.f` stops with its
 *     own wording, "DUE TO PROGRAM BUG, THE FIRST THREE ATOMS MUST NOT LIE IN A
 *     STRAIGHT LINE". A dummy `XX` atom is inserted as the third row to break
 *     the line; it carries no orbitals, and MOPAC drops it from the printed
 *     geometry and from the orbital list.
 * @param elements - Element symbols, one per atom.
 * @param positions - Cartesian coordinates in ångström, in `elements` order.
 * @returns The geometry block, newline-separated, with no trailing newline.
 */
export function geometryBlock(
  elements: readonly string[],
  positions: readonly Point[],
): string {
  const rows: string[] = [];
  if (positions.length > 3) {
    for (let index = 0; index < positions.length; index++) {
      if (index === 2 && needsDummyAtom(positions)) {
        rows.push(
          cartesianRow(
            'XX',
            perpendicularPoint(at(positions, 0), at(positions, 1)),
          ),
        );
      }
      rows.push(cartesianRow(symbolAt(elements, index), at(positions, index)));
    }
    return rows.join('\n');
  }

  rows.push(internalRow(symbolAt(elements, 0), 0, 0, 0, 0, 0));
  if (positions.length >= 2) {
    const bond = distanceBetween(at(positions, 0), at(positions, 1));
    rows.push(internalRow(symbolAt(elements, 1), bond, 0, 0, 1, 0));
  }
  if (positions.length >= 3) {
    const third = at(positions, 2);
    const first = at(positions, 0);
    const second = at(positions, 1);
    // Bond the third atom to whichever of the first two is nearer, so the
    // Z-matrix describes real bonds and MOPAC's distance sanity check passes.
    const nearFirst =
      distanceBetween(third, first) <= distanceBetween(third, second);
    const anchor = nearFirst ? first : second;
    const other = nearFirst ? second : first;
    rows.push(
      internalRow(
        symbolAt(elements, 2),
        distanceBetween(third, anchor),
        angleAt(third, anchor, other),
        0,
        nearFirst ? 1 : 2,
        nearFirst ? 2 : 1,
      ),
    );
  }
  return rows.join('\n');
}

/**
 * Whether the deck this geometry produces carries a dummy `XX` row, which
 * shifts every later atom by one in MOPAC's own numbering.
 * @param positions - Cartesian coordinates in ångström.
 * @returns `true` when a dummy atom has to be inserted.
 */
export function needsDummyAtom(positions: readonly Point[]): boolean {
  if (positions.length <= 3) return false;
  const a = at(positions, 0);
  const b = at(positions, 1);
  const c = at(positions, 2);
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return Math.hypot(cx, cy, cz) < 1e-3;
}

function at(positions: readonly Point[], index: number): Point {
  const point = positions[index];
  if (point === undefined) throw new Error(`no coordinates for atom ${index}`);
  return point;
}

function symbolAt(elements: readonly string[], index: number): string {
  const symbol = elements[index];
  if (symbol === undefined) {
    throw new Error(`no element symbol for atom ${index}`);
  }
  return symbol;
}

function cartesianRow(symbol: string, position: Point): string {
  return (
    ` ${symbol.padEnd(2)} ${fixed(position.x)} 0 ${fixed(position.y)} 0 ` +
    `${fixed(position.z)} 0   0   0   0`
  );
}

function internalRow(
  symbol: string,
  bond: number,
  angle: number,
  twist: number,
  na: number,
  nb: number,
): string {
  return (
    ` ${symbol.padEnd(2)} ${fixed(bond)} 0 ${fixed(angle)} 0 ${fixed(twist)} 0` +
    `   ${na}   ${nb}   0`
  );
}

// A point one ångström from `b`, perpendicular to the a-to-b direction.
function perpendicularPoint(a: Point, b: Point): Point {
  const ax = b.x - a.x;
  const ay = b.y - a.y;
  const az = b.z - a.z;
  const norm = Math.hypot(ax, ay, az) || 1;
  const ux = ax / norm;
  const uy = ay / norm;
  const uz = az / norm;
  const seedX = Math.abs(ux) < 0.9 ? 1 : 0;
  const seedY = Math.abs(ux) < 0.9 ? 0 : 1;
  const dot = seedX * ux + seedY * uy;
  const px = seedX - dot * ux;
  const py = seedY - dot * uy;
  const pz = -dot * uz;
  const length = Math.hypot(px, py, pz) || 1;
  return { x: b.x + px / length, y: b.y + py / length, z: b.z + pz / length };
}

function distanceBetween(p: Point, q: Point): number {
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  const dz = p.z - q.z;
  return Math.hypot(dx, dy, dz);
}

// The a-b-c angle in degrees.
function angleAt(a: Point, b: Point, c: Point): number {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const uz = a.z - b.z;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const vz = c.z - b.z;
  const dot = ux * vx + uy * vy + uz * vz;
  const nu = Math.hypot(ux, uy, uz);
  const nv = Math.hypot(vx, vy, vz);
  const cosine = nu * nv === 0 ? 1 : dot / (nu * nv);
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}

function fixed(value: number): string {
  return value.toFixed(8).padStart(14);
}
