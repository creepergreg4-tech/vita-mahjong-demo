export type Kind = "normal" | "move" | "bomb" | "gift";
export type Tool = "shuffle" | "magnet" | "hint" | "undo";
export interface Position {
  x: number;
  y: number;
  z: number;
}
/** Ring slots include vacancies. Queue order stays fixed; surviving cards compact toward the front. */
export type Movement =
  | {
      type: "ring";
      path: Position[];
      tileIds: number[];
      step: number;
      reversible?: boolean;
    }
  | {
      type: "belt";
      path: Position[];
      tileIds: number[];
      laneLength: number;
      direction: "up" | "right" | "down" | "left";
      periodMs: number;
      step: number;
    }
  | {
      type: "conveyor";
      columns: number[][];
      frontIds: (number | null)[];
      step: number;
    }
  | {
      type: "lines";
      columns: number[][];
      frontIds: (number | null)[];
      rows: 6;
      target: number;
      cleared: number;
      step: number;
    };
export interface Tile {
  bonus?: true;
  id: number;
  x: number;
  y: number;
  z: number;
  face: number;
  kind: Kind;
  removed: boolean;
  hidden: boolean;
  everHidden: boolean;
}
export interface Experiment {
  type: "dragon" | "slots";
  threshold: number;
  maxActivations: number;
  position: "top" | "bottom" | "side";
}
/** Finite ordinary deliveries remain identifiable after shuffle, save and undo. */
export interface ExperimentBatch {
  activation: number;
  ids: number[];
  faces: [number, number, number];
}
export interface Level {
  lineGuide?: number[];
  experiment?: Experiment;
  movement?: Movement;
  id: number;
  name: string;
  subtitle: string;
  difficulty: 1 | 2 | 3;
  tiles: Tile[];
  source: string;
  lesson?: string;
  seed: number;
  solution?: Action[];
}
export type Action =
  | { type: "collect"; a: number }
  | { type: "pair"; a: number; b: number }
  | { type: "wait"; a: -1 }
  | { type: "stash"; a: number };
export interface State {
  experiment?: Experiment & {
    streak: number;
    activations: number;
    batches?: ExperimentBatch[];
  };
  /** Fictional round points, never a measurement of intelligence. */
  bonusIQ?: number;
  bonus?: {
    ids: [number, number];
    remainingMs: number;
    status: "active" | "claimed" | "expired";
  };
  unbelievableCount?: number;
  unbelievableMilestones?: number[];
  movement?: Movement;
  levelId?: number;
  tiles: Tile[];
  /** Ordered four-slot collection tray. These tiles are no longer on the board. */
  tray: number[];
  /** Separate innovation stash. Reservation lasts until the stored tile matches. */
  slot: number | null;
  slotOpen: boolean;
  /** Banked future unlocks; a reserved tile must still match before re-opening. */
  stashCharges?: number;
  slotPending: number | null;
  inventory: Record<Tool, number>;
  seed: number;
  moves: number;
  matches: number;
  combo: number;
  bestCombo: number;
  score: number;
  reward?: string;
}
export interface Event {
  type:
    | "experiment"
    | "collect"
    | "match"
    | "bomb"
    | "gift"
    | "unlock"
    | "stash"
    | "flip"
    | "blocked"
    | "select"
    | "deselect"
    | "hint"
    | "shuffle"
    | "magnet"
    | "undo"
    | "boardMove"
    | "lineClear"
    | "bonusSpawn"
    | "bonusExpire"
    | "notice";
  actor?: "dragon" | "slots";
  result?:
    | "stackNormal"
    | "pairMove"
    | "pairBomb"
    | "fire"
    | "hint"
    | "undo"
    | "magnet"
    | "shuffle"
    | "iq";
  amount?: number;
  previewFaces?: number[];
  charge?: number;
  threshold?: number;
  activation?: number;
  stashCharges?: number;
  rewardCountBefore?: number;
  rewardCountAfter?: number;
  inventoryBefore?: Record<Tool, number>;
  inventoryAfter?: Record<Tool, number>;
  movement?: "ring" | "conveyor" | "belt" | "lines";
  orientation?: "row" | "column";
  lineIndex?: number;
  clearedCount?: number;
  target?: number;
  step?: number;
  positions?: { id: number; from: Position; to: Position }[];
  boardBefore?: {
    tiles: Tile[];
    tray: number[];
    slot: number | null;
    movement?: Movement;
  };
  boardAfter?: {
    tiles: Tile[];
    tray: number[];
    slot: number | null;
    movement?: Movement;
  };
  combo?: number;
  bestCombo?: number;
  ids?: number[];
  text?: string;
  reward?: string;
  positive?: boolean;
  source?: "board" | "tray" | "slot";
  index?: number;
  trayBefore?: number[];
  trayAfter?: number[];
  restored?: { id: number; source: "board" | "tray" | "slot" }[];
}
export const TRAY_CAPACITY = 4;
export const clone = <T>(x: T): T => structuredClone(x);
export function random(s: { seed: number }): number {
  s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
  return s.seed / 4294967296;
}
export function shuffled<T>(a: T[], s: { seed: number }): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
export const same = (a: Tile, b: Tile) =>
  !!a.bonus === !!b.bonus &&
  a.kind === b.kind &&
  (a.kind !== "normal" || a.face === b.face);
export const live = (s: State) => s.tiles.filter((t) => !t.removed);
export const onBoard = (s: State, t: Tile): boolean =>
  !t.removed && s.slot !== t.id && !(s.tray || []).includes(t.id);
/** Board geometry is shared by input, solvers and automatic effects. */
export const overlapsAbove = (a: Tile, b: Tile) =>
  !a.bonus &&
  !b.bonus &&
  b.z > a.z &&
  Math.abs(b.x - a.x) < 0.98 &&
  Math.abs(b.y - a.y) < 0.98;
export const touchesSide = (a: Tile, b: Tile, direction: -1 | 1) =>
  !a.bonus &&
  !b.bonus &&
  b.z === a.z &&
  b.id !== a.id &&
  Math.abs(b.y - a.y) < 0.98 &&
  Math.abs(b.x - a.x - direction) < 0.08;
export function coveringTiles(s: State, t: Tile): number[] {
  if (!onBoard(s, t)) return [];
  const column = conveyorColumn(s, t);
  if (column) {
    const front = queueFront(s, t);
    return isQueued(s, t) && front !== null ? [front] : [];
  }
  return s.tiles
    .filter((o) => onBoard(s, o) && overlapsAbove(t, o))
    .map((o) => o.id);
}
export function blockers(s: State, t: Tile): number[] {
  if (!onBoard(s, t)) return [];
  const column = conveyorColumn(s, t);
  if (column) return coveringTiles(s, t);
  const above = coveringTiles(s, t);
  if (above.length) return above;
  const left = s.tiles.filter((o) => onBoard(s, o) && touchesSide(t, o, -1));
  const right = s.tiles.filter((o) => onBoard(s, o) && touchesSide(t, o, 1));
  return left.length && right.length
    ? [...left, ...right].map((o) => o.id)
    : [];
}
export function exposed(s: State, t: Tile): boolean {
  return !t.removed && coveringTiles(s, t).length === 0;
}
/** Ordinary collection needs no cover AND at least one clear side. */
export function free(s: State, t: Tile): boolean {
  return onBoard(s, t) && blockers(s, t).length === 0;
}
/** Immediate matching opportunities among exposed board, tray and stash cards. */
export function pairs(s: State, visible = true): [Tile, Tile][] {
  const a = live(s).filter(
    (t) =>
      (s.tray.includes(t.id) || s.slot === t.id || free(s, t)) &&
      (!visible || !t.hidden),
  );
  const r: [Tile, Tile][] = [];
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++)
      if (same(a[i], a[j])) r.push([a[i], a[j]]);
  return r;
}
export function canStash(s: State, t: Tile): boolean {
  return (
    s.slotOpen &&
    s.slot === null &&
    s.slotPending == null &&
    !t.removed &&
    !t.bonus &&
    exposed(s, t)
  );
}

export function conveyorColumn(s: State, t: Tile): number[] | undefined {
  return s.movement?.type === "conveyor" || s.movement?.type === "lines"
    ? s.movement.columns.find((column) => column.includes(t.id))
    : undefined;
}
export function queueFront(s: State, t: Tile): number | null {
  const m = s.movement;
  if (m?.type !== "conveyor" && m?.type !== "lines") return null;
  return (
    m.frontIds[m.columns.findIndex((column) => column.includes(t.id))] ?? null
  );
}
export function isQueued(s: State, t: Tile): boolean {
  const m = s.movement;
  if ((m?.type !== "conveyor" && m?.type !== "lines") || !onBoard(s, t))
    return false;
  const index = m.columns.findIndex((column) => column.includes(t.id));
  return index >= 0 && m.frontIds[index] !== t.id;
}
/** Queue depth on board (0 is the only accessible card). -1 means held/removed. */
export function queueDepth(s: State, t: Tile): number {
  const column = conveyorColumn(s, t);
  return column && onBoard(s, t)
    ? s.movement?.type === "lines"
      ? s.movement.rows - 1 - t.y
      : t.y
    : -1;
}
export const boardPosition = (t: Tile): Position => ({
  x: t.x,
  y: t.y,
  z: t.z,
});
/** Bonus cards occupy real vacancies, never a current card or a future moving lane.
 * Re-run after recovery changes the board. Held bonus cards keep their tray position. */
export function relocateBonus(
  s: State,
  preferVacancy = false,
): NonNullable<Event["positions"]> {
  if (s.bonus?.status !== "active") return [];
  const ordinary = s.tiles.filter((t) => !t.bonus && onBoard(s, t));
  const occupied: Position[] = [];
  const positions: NonNullable<Event["positions"]> = [];
  const overlap = (a: Position, b: Position) =>
    Math.abs(a.x - b.x) < 0.98 && Math.abs(a.y - b.y) < 0.98;
  const safe = (p: Position) => {
    if (
      p.y > 5 ||
      ordinary.some((t) => overlap(t, p)) ||
      occupied.some((q) => overlap(p, q))
    )
      return false;
    const m = s.movement;
    if (m?.type === "conveyor" || m?.type === "lines") {
      if (p.y >= 0 && m.columns.some((_, c) => Math.abs(c * 1.2 - p.x) < 0.98))
        return false;
    } else if (m && m.path.some((q) => overlap(p, q))) return false;
    return true;
  };
  s.bonus.ids.forEach((id, index) => {
    const t = s.tiles.find((t) => t.id === id);
    if (!t || !onBoard(s, t)) return;
    let to = boardPosition(t);
    if (preferVacancy || !safe(to)) {
      const vacancy = s.tiles.find(
        (candidate) =>
          !candidate.bonus &&
          candidate.y >= 0 &&
          candidate.y <= 5 &&
          safe(candidate),
      );
      to = vacancy
        ? { x: vacancy.x, y: vacancy.y, z: 0 }
        : { x: index === 0 ? 0 : 5, y: -1.2, z: 0 };
    }
    const from = boardPosition(t);
    if (from.x !== to.x || from.y !== to.y || from.z !== to.z) {
      Object.assign(t, to);
      positions.push({ id, from, to });
    }
    occupied.push(to);
  });
  return positions;
}
/** Reflow is deterministic and also reserves ring slots for held cards returned by shuffle. */
export function moveBoard(
  s: State,
  matched = false,
  timed = false,
  special = false,
  snapshots = true,
): Event[] {
  const m = s.movement;
  if (!m) return [];
  if (m.type === "belt" && matched) return [];
  const boardBefore = snapshots
    ? {
        tiles: clone(s.tiles),
        tray: [...s.tray],
        slot: s.slot,
        movement: clone(m),
      }
    : undefined;
  if (matched || timed)
    m.step += m.type === "ring" && m.reversible && special ? -1 : 1;
  const positions: NonNullable<Event["positions"]> = [];
  const place = (t: Tile, to: Position) => {
    const from = boardPosition(t);
    if (from.x === to.x && from.y === to.y && from.z === to.z) return;
    Object.assign(t, to);
    if (onBoard(s, t)) positions.push({ id: t.id, from, to });
  };
  if (m.type === "ring" || m.type === "belt") {
    for (let i = 0; i < m.tileIds.length; i++) {
      const t = s.tiles.find((t) => t.id === m.tileIds[i])!;
      const length = m.type === "belt" ? m.laneLength : m.path.length;
      const start = Math.floor(i / length) * length;
      const sign =
        m.type === "belt" && (m.direction === "left" || m.direction === "up")
          ? -1
          : 1;
      place(
        t,
        m.path[
          start + ((((i - start + sign * m.step) % length) + length) % length)
        ],
      );
    }
  } else {
    m.columns.forEach((column, x) => {
      let depth = 0;
      m.frontIds[x] = null;
      for (const id of column) {
        const t = s.tiles.find((t) => t.id === id)!;
        if (onBoard(s, t)) {
          if (depth === 0) m.frontIds[x] = id;
          place(t, {
            x: x * 1.2,
            y: m.type === "lines" ? m.rows - 1 - depth++ : depth++,
            z: 0,
          });
        }
      }
    });
  }
  positions.push(...relocateBonus(s));
  return positions.length || matched || timed
    ? [
        {
          type: "boardMove",
          movement: m.type,
          step: m.step,
          positions,
          boardBefore,
          boardAfter: snapshots
            ? {
                tiles: clone(s.tiles),
                tray: [...s.tray],
                slot: s.slot,
                movement: clone(m),
              }
            : undefined,
        },
      ]
    : [];
}

/** The objective includes ordinary tiles held in the tray/stash and finite reserves. */
export function clearedBoard(s: State): boolean {
  return s.tiles.every((t) => t.removed || t.bonus);
}
export function objectiveMet(s: State): boolean {
  return (
    clearedBoard(s) &&
    (s.movement?.type !== "lines" || s.movement.cleared >= s.movement.target)
  );
}
/** Only the six visible cells participate. Rows precede columns; resolve ONE line
 * then refill and rescan. A cross can never remove an odd eleven-card union. */
export function nextCompleteLine(
  s: State,
): { ids: number[]; orientation: "row" | "column"; lineIndex: number } | null {
  const m = s.movement;
  if (m?.type !== "lines") return null;
  const visible = s.tiles.filter(
    (t) =>
      onBoard(s, t) &&
      !t.bonus &&
      !t.hidden &&
      t.kind === "normal" &&
      t.y >= 0 &&
      t.y < m.rows,
  );
  const complete = (ts: Tile[]) =>
    ts.length === 6 && ts.every((t) => t.face === ts[0].face);
  for (let y = 0; y < m.rows; y++) {
    const row = visible.filter((t) => t.y === y).sort((a, b) => a.x - b.x);
    if (complete(row) && new Set(row.map((t) => t.x)).size === 6)
      return { ids: row.map((t) => t.id), orientation: "row", lineIndex: y };
  }
  for (let c = 0; c < m.columns.length; c++) {
    const column = visible
      .filter((t) => t.x === c * 1.2)
      .sort((a, b) => a.y - b.y);
    if (complete(column) && new Set(column.map((t) => t.y)).size === 6)
      return {
        ids: column.map((t) => t.id),
        orientation: "column",
        lineIndex: c,
      };
  }
  return null;
}
/** Every board departure uses the same compaction/cascade path, regardless of cause. */
export function settleBoard(
  s: State,
  matched = false,
  special = false,
  snapshots = true,
): Event[] {
  const events = moveBoard(s, matched, false, special, snapshots);
  if (s.movement?.type !== "lines") return events;
  const snapshot = () => ({
    tiles: clone(s.tiles),
    tray: [...s.tray],
    slot: s.slot,
    movement: clone(s.movement!),
  });
  for (let line = nextCompleteLine(s); line; line = nextCompleteLine(s)) {
    const boardBefore = snapshots ? snapshot() : undefined;
    for (const id of line.ids) s.tiles.find((t) => t.id === id)!.removed = true;
    s.movement.cleared++;
    s.score += 600;
    events.push({
      type: "lineClear",
      ...line,
      clearedCount: s.movement.cleared,
      target: s.movement.target,
      boardBefore,
      boardAfter: snapshots ? snapshot() : undefined,
    });
    events.push(...moveBoard(s, true, false, false, snapshots));
  }
  return events;
}
