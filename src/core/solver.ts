import {
  type Action,
  type State,
  same,
  TRAY_CAPACITY,
  overlapsAbove,
  touchesSide,
  free,
  exposed,
  onBoard,
  objectiveMet,
  clearedBoard,
} from "./model";
// Successful real-engine suffixes remain valid when the UI reaches those states.
// Inventory is deliberately absent: these paths never spend a consumable.
const dynamicWitnesses = new Map<string, Action[]>();
const candidates = new Map<string, Action[]>();
function dynamicKey(s: State): string {
  const m = s.movement;
  return JSON.stringify([
    s.levelId,
    s.tiles
      .filter((t) => !t.removed)
      .map((t) => [
        t.id,
        t.kind,
        t.face,
        +t.hidden,
        +t.everHidden,
        t.x,
        t.y,
        t.z,
      ]),
    s.tray.slice().sort((a, b) => a - b),
    s.slot,
    s.slotOpen,
    s.slotPending,
    s.stashCharges || 0,
    s.seed,
    s.experiment,
    m?.type === "belt"
      ? { ...m, step: m.step % m.laneLength }
      : m?.type === "ring"
        ? {
            ...m,
            step: ((m.step % m.path.length) + m.path.length) % m.path.length,
          }
        : m,
    s.matches,
    s.combo,
    s.bestCombo,
    s.unbelievableCount,
    s.unbelievableMilestones,
    s.bonus?.status,
    s.bonus?.remainingMs,
  ]);
}
export function registerWitness(s: State, path: Action[]): void {
  candidates.set(dynamicKey(s), path);
  if (candidates.size > 64) candidates.delete(candidates.keys().next().value!);
}
let transition: ((s: State, a: Action) => State) | undefined;
export function registerTransition(fn: (s: State, a: Action) => State) {
  transition = fn;
}

/** Dynamic geometry cannot use cached static cover masks. Branch real engine states. */
function solveDynamic(
  initial: State,
  maxNodes: number,
  maxTimeMs: number,
): Action[] | null {
  if (!transition) return null;
  const failed = new Set<string>(),
    active = new Set<string>();
  const deadline = performance.now() + maxTimeMs;
  let nodes = 0;
  const candidate = candidates.get(dynamicKey(initial));
  if (candidate && candidate.length <= maxNodes) {
    const states: string[] = [];
    let replay = initial;
    for (const action of candidate) {
      if (performance.now() > deadline) break;
      states.push(dynamicKey(replay));
      replay = transition(replay, action);
    }
    if (states.length === candidate.length && objectiveMet(replay)) {
      states.forEach((key, i) => dynamicWitnesses.set(key, candidate.slice(i)));
      return candidate.slice();
    }
  }
  const dfs = (s: State): Action[] | null => {
    if (objectiveMet(s)) return [];
    if (clearedBoard(s)) return null;
    if (
      s.movement?.type === "lines" &&
      s.tiles.filter((t) => !t.removed && !t.bonus).length <
        (s.movement.target - s.movement.cleared) * 6
    )
      return null;
    if (++nodes > maxNodes || performance.now() > deadline) return null;
    const m = s.movement;
    const key = dynamicKey(s);
    const known = dynamicWitnesses.get(key);
    if (known) return known.slice();
    if (failed.has(key) || active.has(key)) return null;
    active.add(key);
    const held = s.tray.map((id) => s.tiles.find((t) => t.id === id)!);
    const available =
      s.tray.length < TRAY_CAPACITY
        ? s.tiles.filter((t) => free(s, t) || (!t.removed && t.id === s.slot))
        : [];
    // A matching pair can destroy a future line. Rank actual post-gravity
    // cascades first so the bounded oracle plans toward BOTH objective parts.
    const lineNext = new Map<number, State>();
    if (m?.type === "lines")
      for (const t of available)
        lineNext.set(t.id, transition!(s, { type: "collect", a: t.id }));
    const rank = (id: number) => {
      const t = s.tiles.find((t) => t.id === id)!;
      const nextMovement = lineNext.get(id)?.movement;
      return (
        (m?.type === "lines" && nextMovement?.type === "lines"
          ? (nextMovement.cleared - m.cleared) * 100000
          : 0) +
        (held.some((h) => same(h, t)) ? 10000 : 0) +
        (available.some((o) => o.id !== id && same(o, t)) ? 1000 : 0) +
        t.z * 3 +
        (t.kind === "move" ? 2 : 0)
      );
    };
    const actions: Action[] = available
      .sort((a, b) => rank(b.id) - rank(a.id))
      .map((t) => ({ type: "collect", a: t.id }));
    if (
      (s.slotOpen || (s.stashCharges || 0) > 0) &&
      s.slot === null &&
      s.slotPending === null
    ) {
      const candidates = s.tiles.filter(
        (t) =>
          !t.removed &&
          !t.bonus &&
          (s.tray.includes(t.id) || (onBoard(s, t) && exposed(s, t))),
      );
      actions.push(
        ...candidates.map((t) => ({ type: "stash" as const, a: t.id })),
      );
    }
    if (m?.type === "belt" || s.bonus?.status === "active")
      actions.push({ type: "wait", a: -1 });
    for (const a of actions) {
      const next =
        a.type === "collect"
          ? lineNext.get(a.a) || transition!(s, a)
          : transition!(s, a);
      const tail = dfs(next);
      if (tail) {
        active.delete(key);
        const path = [a, ...tail];
        dynamicWitnesses.set(key, path);
        if (dynamicWitnesses.size > 5000)
          dynamicWitnesses.delete(dynamicWitnesses.keys().next().value!);
        return path;
      }
      if (nodes > maxNodes || performance.now() > deadline) {
        active.delete(key);
        return null;
      }
    }
    active.delete(key);
    failed.add(key);
    return null;
  };
  // Callers consume plans with shift/splice. Never expose the cached array.
  const result = dfs(initial);
  return result ? result.slice() : null;
}
/** Bounded, memoized sequential-collection search. null includes budget exhaustion.
 * Gifts/blasts are optional benefits in the search; callers replan after actual effects.
 * Hidden tiles can be revealed without capacity cost; hint/apply handle that first tap.
 */
export function solve(
  s: State,
  maxNodes = 60000,
  maxTimeMs = 65,
): Action[] | null {
  if (s.movement || s.experiment || s.bonus?.status === "active")
    return solveDynamic(s, maxNodes, maxTimeMs);
  const ts = s.tiles,
    n = ts.length;
  const bit = ts.map((_, i) => 1n << BigInt(i));
  const index = new Map(ts.map((t, i) => [t.id, i]));
  const up = ts.map((a) =>
    ts.reduce((m, b, j) => (overlapsAbove(a, b) ? m | bit[j] : m), 0n),
  );
  const left = ts.map((a) =>
    ts.reduce((m, b, j) => (touchesSide(a, b, -1) ? m | bit[j] : m), 0n),
  );
  const right = ts.map((a) =>
    ts.reduce((m, b, j) => (touchesSide(a, b, 1) ? m | bit[j] : m), 0n),
  );
  let initial = 0n;
  ts.forEach((t, i) => {
    if (!t.removed) initial |= bit[i];
  });
  const initialTray = (s.tray || []).map((id) => index.get(id)!);
  const failed = new Set<string>();
  const active = new Set<string>();
  let nodes = 0;
  const deadline = performance.now() + maxTimeMs;
  const exhausted = () => nodes > maxNodes || performance.now() > deadline;
  function dfs(
    m: bigint,
    tray: number[],
    slot: number,
    open: boolean,
    pending: number,
    charges: number,
  ): Action[] | null {
    if (!m) return [];
    if (++nodes > maxNodes || (nodes % 64 === 0 && exhausted())) return null;
    // Tray order has no effect on reachability; IDs still matter to reservation/geometry.
    const key = `${m.toString(36)}:${tray.slice().sort((a, b) => a - b)}:${slot}:${+open}:${pending}:${charges}`;
    if (failed.has(key) || active.has(key)) return null;
    active.add(key);
    let board = m;
    for (const i of tray) board &= ~bit[i];
    if (slot >= 0) board &= ~bit[slot];
    const available: number[] = [];
    if (tray.length < TRAY_CAPACITY) {
      for (let i = 0; i < n; i++)
        if (
          board & bit[i] &&
          !(up[i] & board) &&
          (!(left[i] & board) || !(right[i] & board))
        )
          available.push(i);
      if (slot >= 0) available.push(slot);
    }
    available.sort((a, b) => {
      const rank = (i: number) =>
        (tray.some((j) => same(ts[i], ts[j])) ? 1000 : 0) +
        (available.some((j) => j !== i && same(ts[i], ts[j])) ? 100 : 0) +
        ts[i].z * 3 +
        (ts[i].kind === "move" ? 2 : 0);
      return rank(b) - rank(a);
    });
    for (const i of available) {
      const partner = tray.find((j) => same(ts[i], ts[j]));
      let nextM = m,
        nextTray: number[],
        nextOpen = open,
        nextPending = pending,
        nextCharges = charges;
      if (partner !== undefined) {
        nextM &= ~bit[i] & ~bit[partner];
        nextTray = tray.filter((j) => j !== partner);
        if (pending === i || pending === partner) {
          nextPending = -1;
          nextOpen = false;
        }
        if (ts[i].kind === "move") {
          if (!nextOpen && nextPending < 0) nextOpen = true;
          else nextCharges = Math.min(3, nextCharges + 1);
        }
      } else nextTray = [...tray, i];
      const tail = dfs(
        nextM,
        nextTray,
        i === slot ? -1 : slot,
        nextOpen,
        nextPending,
        nextCharges,
      );
      if (tail) {
        active.delete(key);
        return [{ type: "collect", a: ts[i].id }, ...tail];
      }
      if (exhausted()) {
        active.delete(key);
        return null;
      }
    }
    if ((open || charges > 0) && slot < 0 && pending < 0) {
      // Holding one tray card is useful even when four unmatched cards filled the tray.
      const candidates = [...tray];
      for (let i = 0; i < n; i++)
        if (board & bit[i] && !(up[i] & board)) candidates.push(i);
      for (const i of candidates) {
        if (ts[i].bonus) continue;
        const tail = dfs(
          m,
          tray.filter((j) => j !== i),
          i,
          true,
          i,
          charges - Number(!open),
        );
        if (tail) {
          active.delete(key);
          return [{ type: "stash", a: ts[i].id }, ...tail];
        }
        if (exhausted()) {
          active.delete(key);
          return null;
        }
      }
    }
    active.delete(key);
    failed.add(key);
    return null;
  }
  return dfs(
    initial,
    initialTray,
    s.slot == null ? -1 : index.get(s.slot)!,
    s.slotOpen,
    s.slotPending == null
      ? s.slot == null
        ? -1
        : index.get(s.slot)!
      : index.get(s.slotPending)!,
    s.stashCharges || 0,
  );
}
