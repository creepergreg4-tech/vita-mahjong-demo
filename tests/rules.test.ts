import test from "node:test";
import assert from "node:assert/strict";
import { makeLineLevel } from "../src/core/levels";
import lineData from "../src/core/line-level-data.json";
import { Puzzle } from "../src/core/rules";
import { solve } from "../src/core/solver";
import {
  free,
  exposed,
  onBoard,
  live,
  clone,
  canStash,
  moveBoard,
  settleBoard,
  nextCompleteLine,
  isQueued,
  queueDepth,
  same,
  type Level,
  type Tile,
} from "../src/core/model";
const tile = (
  id: number,
  face: number,
  x = id * 2,
  y = 0,
  z = 0,
  kind: Tile["kind"] = "normal",
): Tile => ({
  id,
  face,
  x,
  y,
  z,
  kind,
  removed: false,
  hidden: false,
  everHidden: false,
});

const ringGame = () => {
  const path = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 1, z: 0 },
    { x: 2, y: 2, z: 0 },
    { x: 1, y: 2, z: 0 },
    { x: 0, y: 2, z: 0 },
    { x: 0, y: 1, z: 0 },
  ];
  const p = game(
    path.map((p, i) => tile(i, [0, 1, 0, 2, 1, 3, 2, 3][i], p.x, p.y, p.z)),
  );
  p.level.movement = {
    type: "ring",
    path,
    tileIds: path.map((_, i) => i),
    step: 0,
  };
  p.s.movement = clone(p.level.movement);
  p.s.levelId = p.level.id;
  return p;
};
const conveyorGame = () => {
  const columns = [
      [0, 1],
      [2, 3],
      [4, 5],
    ],
    p = game([
      tile(0, 0, 0, 0),
      tile(1, 2, 0, 1),
      tile(2, 0, 1.2, 0),
      tile(3, 1, 1.2, 1),
      tile(4, 2, 2.4, 0),
      tile(5, 1, 2.4, 1),
    ]);
  p.level.movement = {
    type: "conveyor",
    columns,
    frontIds: [0, 2, 4],
    step: 0,
  };
  p.s.movement = clone(p.level.movement);
  p.s.levelId = p.level.id;
  return p;
};

test("ring shifts exactly one path cell per successful pair; unmatched, blocked and reveal taps never shift", () => {
  const p = ringGame(),
    start = clone(p.s.tiles);
  assert.equal(p.tap(1)[0].type, "blocked");
  assert.equal(p.s.movement!.step, 0);
  p.s.tiles[0].hidden = true;
  assert.equal(p.tap(0)[0].type, "flip");
  assert.equal(p.s.movement!.step, 0);
  assert.ok(!p.tap(0).some((e) => e.type === "boardMove"));
  assert.equal(p.s.movement!.step, 0);
  assert.equal(p.s.tiles[3].y, start[3].y);
  const events = p.tap(2),
    moves = events.filter((e) => e.type === "boardMove");
  assert.equal(moves.length, 1);
  assert.equal(p.s.movement!.step, 1);
  const m = p.s.movement!;
  assert.equal(m.type, "ring");
  if (m.type !== "ring") throw Error();
  for (let i = 0; i < 8; i++)
    assert.deepEqual(
      { x: p.s.tiles[i].x, y: p.s.tiles[i].y, z: p.s.tiles[i].z },
      m.path[(i + 1) % 8],
    );
  assert.equal(moves[0].boardBefore!.movement!.step, 0);
  assert.equal(moves[0].boardAfter!.movement!.step, 1);
});

test("conveyor fronts refill immediately on unmatched collection and board stash", () => {
  const p = conveyorGame();
  assert.ok(free(p.s, p.s.tiles[2]));
  assert.ok(isQueued(p.s, p.s.tiles[1]));
  assert.equal(queueDepth(p.s, p.s.tiles[1]), 1);
  const single = p.tap(0);
  assert.ok(single.some((e) => e.type === "boardMove"));
  assert.ok(free(p.s, p.s.tiles[1]));
  assert.equal(p.s.tiles[1].y, 0);
  assert.equal(p.s.movement!.step, 0);
  const ev = p.tap(2);
  assert.equal(ev.filter((e) => e.type === "boardMove").length, 1);
  assert.equal(p.s.tiles[1].y, 0);
  assert.ok(free(p.s, p.s.tiles[1]));
  assert.equal(p.s.movement!.step, 1);
  p.s.slotOpen = true;
  p.toggleStash();
  p.tap(4);
  assert.equal(p.s.movement!.step, 1);
  assert.equal(queueDepth(p.s, p.s.tiles[4]), -1);
  assert.equal(p.s.tiles[5].y, 0);
  assert.ok(free(p.s, p.s.tiles[5]));
});

test("magnet and every bomb pair independently advance the ring and emit immutable animation snapshots", () => {
  const p = ringGame();
  p.s.tiles.forEach((t) => {
    t.kind = "normal";
    t.face = 0;
  });
  const ev = p.blast(),
    steps = ev.filter((e) => e.type === "boardMove");
  assert.equal(p.s.matches, 2);
  assert.equal(p.s.movement!.step, 2);
  assert.deepEqual(
    steps.map((e) => e.step),
    [1, 2],
  );
  assert.equal(steps[0].boardAfter!.movement!.step, 1);
  assert.equal(steps[1].boardAfter!.movement!.step, 2);
  const before = p.s.matches,
    magnet = p.use("magnet");
  assert.equal(p.s.matches, before + 1);
  assert.equal(p.s.movement!.step, p.s.matches);
  assert.equal(magnet.filter((e) => e.type === "boardMove").length, 1);
});

test("dynamic undo and save restore coordinates, queue vacancy and movement phase; corrupted saves rejected", () => {
  for (const p of [ringGame(), conveyorGame()]) {
    p.tap(0);
    const vacancy = clone(p.s),
      q = p.s.movement!.type === "ring" ? ringGame() : conveyorGame();
    assert.ok(q.restore(p.export()));
    assert.deepEqual(q.s, p.s);
    p.tap(2);
    const after = clone(p.s);
    assert.ok(q.restore(p.export()));
    assert.deepEqual(q.s, after);
    const tampered = p.export();
    tampered.state.movement!.step++;
    assert.equal(q.restore(tampered), false);
    const badPosition = p.export();
    const board = badPosition.state.tiles.find((t) =>
      onBoard(badPosition.state, t),
    )!;
    board.x += 0.4;
    assert.equal(q.restore(badPosition), false);
    p.use("undo");
    assert.deepEqual(p.s.tiles, vacancy.tiles);
    assert.deepEqual(p.s.movement, vacancy.movement);
    assert.deepEqual(p.s.tray, vacancy.tray);
  }
  const p = ringGame(),
    old = p.export();
  assert.equal(p.restore({ ...old, rulesVersion: 3 }), false);
});

test("dynamic oracle branches actual legal transitions, respects queue vacancies and budget", () => {
  for (const p of [ringGame(), conveyorGame()]) {
    assert.equal(solve(p.s, 1, 100), null);
    const path = solve(p.s, 60000, 1000);
    assert.ok(path);
    for (const a of path) {
      const t = p.s.tiles.find((t) => t.id === a.a)!;
      assert.ok(free(p.s, t) || p.s.slot === t.id);
      p.apply(a);
    }
    assert.ok(p.won);
    assert.equal(p.s.movement!.step, p.s.matches);
  }
});

test("dynamic shuffle keeps live faces and validates a new moving-layout witness", () => {
  for (const p of [ringGame(), conveyorGame()]) {
    p.tap(0);
    const phase = p.s.movement!.step,
      faces = () =>
        live(p.s)
          .map((t) => `${t.kind}:${t.face}`)
          .sort(),
      before = faces();
    assert.equal(p.use("shuffle")[0].type, "shuffle");
    assert.equal(p.s.movement!.step, phase);
    assert.deepEqual(faces(), before);
    assert.deepEqual(p.s.tray, []);
    const path = solve(p.s, 60000, 1000);
    assert.ok(path);
    for (const a of path) p.apply(a);
    assert.ok(p.won);
  }
});

test("combo counts consecutive pair decisions, survives first pickup and pauses, resets for another unmatched face", () => {
  const p = game([0, 0, 1, 1, 2, 2, 3, 3].map((face, i) => tile(i, face)));
  p.tap(0);
  const first = p.tap(1).find((e) => e.type === "match")!;
  assert.equal(first.combo, 1);
  assert.equal(first.bestCombo, 1);
  p.tap(2);
  assert.equal(p.s.combo, 1);
  p.tap(3);
  assert.equal(p.s.combo, 2);
  p.tap(4);
  p.s.tiles[6].hidden = true;
  p.tap(6);
  assert.equal(p.s.combo, 2); // reveal / thinking do not reset
  p.tap(6);
  assert.equal(p.s.combo, 0);
  assert.equal(p.s.bestCombo, 2);
  const held = p.tap(5).find((e) => e.type === "match")!;
  assert.equal(held.combo, 1);
  assert.equal(held.bestCombo, 2);
  assert.deepEqual(p.s.tray, [6]);
});
const game = (tiles: Tile[], id = 15) =>
  new Puzzle({
    id,
    name: "fixture",
    subtitle: "",
    difficulty: 1,
    seed: 7,
    source: "test",
    tiles,
  });
const basic = () =>
  game([
    tile(0, 0),
    tile(1, 1),
    tile(2, 2),
    tile(3, 0),
    tile(4, 1),
    tile(5, 2),
  ]);
const negativeSeed = () => {
  let seed = 1;
  while (((Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296 < 0.85)
    seed++;
  return seed;
};

test("surface middle tile is blocked by both sides; holding a neighbor opens that side", () => {
  const p = game([tile(0, 0, 0), tile(1, 1, 1), tile(2, 2, 2), tile(3, 1, 4)]);
  assert.equal(exposed(p.s, p.s.tiles[1]), true);
  assert.equal(free(p.s, p.s.tiles[1]), false);
  const before = clone(p.s);
  const ev = p.tap(1);
  assert.equal(ev[0].type, "blocked");
  assert.deepEqual(ev[0].ids, [0, 2]);
  assert.deepEqual(p.s, before);
  assert.equal(p.history.length, 0);
  p.tap(0);
  assert.equal(free(p.s, p.s.tiles[1]), true);
  assert.equal(p.tap(1)[0].type, "collect");
  assert.deepEqual(p.s.tray, [0, 1]);
  assert.equal(p.s.tiles[1].removed, false);
  assert.equal(onBoard(p.s, p.s.tiles[1]), false);
});

test("a matching tile already in the tray never authorizes taking its clamped partner", () => {
  const p = game([tile(0, 0, 0), tile(1, 1, 1), tile(2, 2, 2), tile(3, 1, 4)]);
  p.tap(3);
  const before = clone(p.s);
  assert.equal(p.tap(1)[0].type, "blocked");
  assert.deepEqual(p.s, before);
  assert.deepEqual(p.s.tray, [3]);
});
test("side checks include staggered overlap, but exclude different tiers and removed/held neighbors", () => {
  for (const y of [-0.97, -0.5, 0, 0.5, 0.97]) {
    const p = game([tile(0, 0, 0, y), tile(1, 1, 1), tile(2, 2, 2, -y)]);
    assert.equal(free(p.s, p.s.tiles[1]), false, `overlap ${y}`);
  }
  for (const y of [-1, 1]) {
    const p = game([tile(0, 0, 0, y), tile(1, 1, 1), tile(2, 2, 2, -y)]);
    assert.equal(free(p.s, p.s.tiles[1]), true);
  }
  const p = game([tile(0, 0, 0), tile(1, 1, 1), tile(2, 2, 2)]);
  p.s.tray = [0];
  assert.equal(free(p.s, p.s.tiles[1]), true);
  p.s.tray = [];
  p.s.slot = 0;
  assert.equal(free(p.s, p.s.tiles[1]), true);
  p.s.slot = null;
  p.s.tiles[0].removed = true;
  assert.equal(free(p.s, p.s.tiles[1]), true);
  const high = game([
    tile(0, 0, 0, 0, 0),
    tile(1, 1, 1, 0, 1),
    tile(2, 2, 2, 0, 0),
  ]);
  assert.equal(free(high.s, high.s.tiles[1]), true);
});
test("ability tile faces do not bypass ordinary side restrictions before activation", () => {
  for (const kind of ["move", "bomb", "gift"] as const) {
    const p = game([tile(0, 0, 0), tile(1, 0, 1, 0, 0, kind), tile(2, 2, 2)]);
    assert.equal(p.tap(1)[0].type, "blocked");
    assert.deepEqual(p.s.tray, []);
    assert.equal(p.s.slotOpen, false);
  }
});
test("unlocked stash explicitly permits a surface clamped normal; no normal tap does", () => {
  const p = game([tile(0, 0, 0), tile(1, 1, 1), tile(2, 2, 2), tile(3, 1, 4)]);
  assert.equal(p.tap(1)[0].type, "blocked");
  p.s.slotOpen = true;
  p.toggleStash();
  assert.equal(p.tap(1)[0].type, "stash");
  assert.equal(p.s.slot, 1);
  assert.deepEqual(p.s.tray, []);
});
test("initial screenshot geometry: bottom x1 tile stays on board when both bottom neighbors exist", async () => {
  const { makeLevels } = await import("../src/core/levels");
  const p = new Puzzle(makeLevels()[0]);
  const y = Math.max(...p.s.tiles.filter((t) => t.z === 0).map((t) => t.y));
  const t = p.s.tiles.find((t) => t.z === 0 && t.y === y && t.x === 1)!;
  assert.ok(t);
  const before = clone(p.s);
  assert.equal(p.tap(t.id)[0].type, "blocked");
  assert.deepEqual(p.s, before);
});
test("covered tiles cannot collect or stash; collected cover immediately reveals underneath", () => {
  const p = game([
    tile(0, 0, 0, 0, 0),
    tile(1, 1, 0, 0, 1),
    tile(2, 0, 4),
    tile(3, 1, 6),
  ]);
  assert.equal(p.tap(0)[0].type, "blocked");
  p.s.slotOpen = true;
  p.toggleStash();
  assert.equal(p.tap(0)[0].type, "notice");
  assert.equal(p.s.slot, null);
  p.toggleStash();
  p.tap(1);
  assert.equal(free(p.s, p.s.tiles[0]), true);
  p.tap(0);
  assert.deepEqual(p.s.tray, [1, 0]);
});
test("unmatched taps persist, incoming match inserts beside earlier match then compacts", () => {
  const p = basic();
  p.tap(0);
  p.tap(1);
  p.tap(2);
  const ev = p.tap(3);
  assert.deepEqual(
    ev.map((e) => e.type),
    ["collect", "match"],
  );
  assert.deepEqual(ev[0].trayBefore, [0, 1, 2]);
  assert.deepEqual(ev[0].trayAfter, [0, 3, 1, 2]);
  assert.equal(ev[0].index, 1);
  assert.deepEqual(ev[1].trayBefore, [0, 3, 1, 2]);
  assert.deepEqual(ev[1].trayAfter, [1, 2]);
  assert.deepEqual(p.s.tray, [1, 2]);
  assert.equal(p.s.matches, 1);
});
test("four unmatched cards stall provisionally; fifth tap cannot overflow or erase cards", () => {
  const p = game([0, 1, 2, 3, 0, 1, 2, 3].map((f, i) => tile(i, f)));
  [0, 1, 2, 3].forEach((i) => p.tap(i));
  assert.equal(p.full, true);
  assert.equal(p.stalled, true);
  const before = clone(p.s);
  assert.equal(p.tap(4)[0].type, "notice");
  assert.deepEqual(p.s, before);
  assert.equal(p.won, false);
  p.use("undo");
  assert.deepEqual(p.s.tray, [0, 1, 2]);
  assert.equal(p.full, false);
});
test("tapping a held tray tile neither recollects nor cancels it", () => {
  const p = basic();
  p.tap(0);
  assert.deepEqual(p.tap(0), []);
  assert.deepEqual(p.s.tray, [0]);
  assert.equal(p.history.length, 1);
});
test("undo reverts one collection including its automatic pair, then earlier collection", () => {
  const p = basic();
  p.tap(0);
  p.tap(3);
  const ev = p.use("undo")[0];
  assert.deepEqual(p.s.tray, [0]);
  assert.equal(p.s.matches, 0);
  assert.equal(p.s.tiles[3].removed, false);
  assert.deepEqual(ev.restored, [
    { id: 0, source: "tray" },
    { id: 3, source: "board" },
  ]);
  assert.equal(p.s.inventory.undo, 3);
  p.use("undo");
  assert.deepEqual(p.s.tray, []);
  assert.equal(p.s.inventory.undo, 2);
});
test("move pair unlocks separate stash; transfer keeps reservation until actual match", () => {
  const p = game([
    tile(0, 0, 0, 0, 0, "move"),
    tile(1, 0, 2, 0, 0, "move"),
    tile(2, 2, 4),
    tile(3, 2, 6),
    tile(4, 4, 8),
    tile(5, 4, 10),
  ]);
  p.tap(0);
  assert.equal(p.s.slotOpen, false);
  p.tap(1);
  assert.equal(p.s.slotOpen, true);
  p.toggleStash();
  p.tap(2);
  assert.equal(p.s.slot, 2);
  assert.equal(p.s.slotPending, 2);
  const ev = p.toggleStash();
  assert.equal(ev[0].source, "slot");
  assert.deepEqual(p.s.tray, [2]);
  assert.equal(p.s.slot, null);
  assert.equal(p.s.slotOpen, true);
  assert.equal(canStash(p.s, p.s.tiles[4]), false);
  p.tap(3);
  assert.equal(p.s.slotPending, null);
  assert.equal(p.s.slotOpen, false);
  p.use("undo");
  assert.equal(p.s.slotPending, 2);
  assert.equal(p.s.slotOpen, true);
  assert.deepEqual(p.s.tray, [2]);
});
test("stash can free one place from full tray, without destroying or matching its tile", () => {
  const p = game([0, 1, 2, 3, 0, 1, 2, 3].map((f, i) => tile(i, f)));
  p.s.slotOpen = true;
  [0, 1, 2, 3].forEach((i) => p.tap(i));
  p.toggleStash();
  const ev = p.tap(1);
  assert.equal(ev[0].source, "tray");
  assert.equal(p.s.slot, 1);
  assert.equal(p.s.slotPending, 1);
  assert.deepEqual(p.s.tray, [0, 2, 3]);
  assert.equal(p.full, false);
  p.tap(4);
  assert.deepEqual(p.s.tray, [2, 3]);
  p.toggleStash();
  assert.deepEqual(p.s.tray, [2, 3, 1]);
  p.tap(5);
  assert.equal(p.s.slotOpen, false);
});
test("full tray prevents occupied stash from overflowing on return", () => {
  const p = game([0, 1, 2, 3, 4, 0, 1, 2, 3, 4].map((f, i) => tile(i, f)));
  p.s.slotOpen = true;
  p.toggleStash();
  p.tap(0);
  [1, 2, 3, 4].forEach((i) => p.tap(i));
  assert.equal(p.toggleStash()[0].type, "notice");
  assert.equal(p.s.slot, 0);
  assert.equal(p.s.tray.length, 4);
});
test("bomb auto-collects up to two disjoint uncovered normal board pairs via ordinary tray events", () => {
  const p = game([
    tile(0, 0),
    tile(1, 0),
    tile(2, 1),
    tile(3, 1),
    tile(4, 2),
    tile(5, 2),
    tile(6, 3, 20, 0, 0),
    tile(7, 3, 20, 0, 1),
  ]);
  const ev = p.blast();
  assert.equal(ev[0].type, "bomb");
  assert.equal(ev.filter((e) => e.type === "collect").length, 4);
  assert.equal(ev.filter((e) => e.type === "match").length, 2);
  assert.equal(p.s.matches, 2);
  assert.deepEqual(p.s.tray, []);
  assert.equal(p.s.tiles[6].removed, false);
  assert.equal(p.s.tiles[7].removed, false);
});
test("bomb excludes tray/stash targets and respects capacity rather than spilling a fifth tile", () => {
  const p = game([0, 1, 2, 3, 0, 1, 2, 3, 4, 4].map((f, i) => tile(i, f)));
  p.tap(0);
  p.tap(1);
  p.tap(2);
  assert.equal(p.blast().filter((e) => e.type === "collect").length, 0);
  assert.deepEqual(p.s.tray, [0, 1, 2]);
  p.s.slotOpen = true;
  p.toggleStash();
  p.tap(3);
  assert.equal(p.blast()[0].ids?.length, 0);
});
test("magnet at full capacity can absorb a covered match and frees occupied capacity", () => {
  const p = game([
    tile(0, 0),
    tile(1, 1),
    tile(2, 2),
    tile(3, 3),
    tile(4, 0, 20, 0, 0),
    tile(5, 4, 20, 0, 1),
    tile(6, 4, 24),
    tile(7, 1),
    tile(8, 2),
    tile(9, 3),
  ]);
  [0, 1, 2, 3].forEach((i) => p.tap(i));
  assert.equal(free(p.s, p.s.tiles[4]), false);
  const ev = p.use("magnet");
  assert.equal(ev[0].type, "magnet");
  assert.deepEqual(ev[0].ids, [0, 4]);
  assert.deepEqual(p.s.tray, [1, 2, 3]);
  assert.equal(p.s.inventory.magnet, 1);
  p.use("undo");
  assert.equal(p.full, true);
  assert.equal(p.s.inventory.magnet, 2);
});
test("magnet resolves move, bomb and gift identities through the same special effects", () => {
  for (const kind of ["move", "bomb", "gift"] as const) {
    const p = game(
      [
        tile(0, 0, 0, 0, 0, kind),
        tile(1, 0, 2, 0, 0, kind),
        tile(2, 1),
        tile(3, 1),
      ],
      13,
    );
    const ev = p.use("magnet");
    assert.ok(ev.some((e) => e.type === (kind === "move" ? "unlock" : kind)));
    if (kind === "move") assert.equal(p.s.slotOpen, true);
    if (kind === "gift") assert.equal(p.s.inventory.undo, 5);
  }
});
test("negative gift veils at most four exposed never-veiled board normals; flip does not collect", () => {
  const p = game(
    [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5].map((f, i) => tile(i, f)),
  );
  p.tap(0);
  p.s.slotOpen = true;
  p.toggleStash();
  p.tap(1);
  p.s.seed = negativeSeed();
  const ev = p.gift()[0];
  assert.equal(ev.positive, false);
  assert.ok(ev.ids!.length <= 4);
  assert.ok(ev.ids!.every((id) => id !== 0 && id !== 1));
  const ids = [...ev.ids!];
  for (const id of ids) {
    assert.equal(exposed(p.s, p.s.tiles[id]), true);
    assert.equal(p.tap(id)[0].type, "flip");
    assert.equal(p.s.tiles[id].hidden, false);
    assert.equal(onBoard(p.s, p.s.tiles[id]), true);
  }
  p.s.seed = negativeSeed();
  p.gift();
  assert.ok(ids.every((id) => !p.s.tiles[id].hidden));
});
test("undo gift restores reward, PRNG, pair and individual input; gift cannot fund its own endless undo", () => {
  const p = game(
    [
      tile(0, 0, 0, 0, 0, "gift"),
      tile(1, 0, 2, 0, 0, "gift"),
      tile(2, 1),
      tile(3, 1),
    ],
    13,
  );
  p.tap(0);
  const seed = p.s.seed;
  let undone = 0;
  for (let i = 0; i < 8; i++) {
    p.tap(1);
    if (p.use("undo")[0].type === "undo") {
      undone++;
      assert.equal(p.s.seed, seed);
      assert.deepEqual(p.s.tray, [0]);
    } else break;
  }
  assert.equal(undone, 4);
  assert.equal(p.s.inventory.undo, 1);
  assert.equal(p.s.tiles[0].removed, true);
});
test("hint names one next collection and asks for hidden reveal first; hint cost persists across undo", () => {
  const p = basic();
  p.tap(0);
  p.s.tiles[3].hidden = true;
  p.s.tiles[3].everHidden = true;
  const hint = p.use("hint")[0];
  assert.equal(hint.type, "hint");
  assert.deepEqual(hint.ids, [3]);
  assert.equal(hint.text, "先翻开这张牌");
  p.use("undo");
  assert.equal(p.s.inventory.hint, 2);
});
test("solver finds sequential revealing path where no initially exposed pair exists", () => {
  const p = game([
    tile(0, 0, 0, 0, 1),
    tile(1, 1, 0, 0, 0),
    tile(2, 1, 3, 0, 1),
    tile(3, 0, 3, 0, 0),
  ]);
  const path = solve(p.s);
  assert.ok(path?.length);
  assert.ok(path.every((a) => a.type === "collect"));
  for (const a of path) p.apply(a);
  assert.equal(p.won, true);
});
test("solver models full-tray rescue using the extra stash and consumes reservation only on matching", () => {
  const p = game([0, 1, 2, 3, 0, 1, 2, 3].map((f, i) => tile(i, f)));
  [0, 1, 2, 3].forEach((i) => p.tap(i));
  p.s.slotOpen = true;
  const path = solve(p.s);
  assert.ok(path);
  assert.equal(path[0].type, "stash");
  for (const a of path) p.apply(a);
  assert.equal(p.won, true);
  assert.equal(p.s.slotOpen, false);
});
test("solver returns null promptly on bounded search, handles >64 tile masks", () => {
  const p = game(
    Array.from({ length: 144 }, (_, i) =>
      tile(i, Math.floor(i / 2) % 24, (i % 12) * 1.1, Math.floor(i / 12) * 1.1),
    ),
  );
  const start = performance.now();
  const path = solve(p.s);
  assert.ok(path);
  assert.ok(performance.now() - start < 500);
  for (const a of path) p.apply(a);
  assert.equal(p.won, true);
  const q = game([0, 1, 2, 3, 0, 1, 2, 3].map((f, i) => tile(i, f)));
  assert.equal(solve(q.s, 1), null);
});
test("shuffle recovers full tray, preserves live multiset, and returns a playable witness", () => {
  const p = game([0, 1, 2, 3, 0, 1, 2, 3].map((f, i) => tile(i, f)));
  [0, 1, 2, 3].forEach((i) => p.tap(i));
  const keys = () =>
      live(p.s)
        .map((t) => t.kind + ":" + t.face)
        .sort(),
    before = keys();
  const ev = p.use("shuffle");
  assert.equal(ev[0].type, "shuffle");
  assert.deepEqual(ev[0].trayBefore, [0, 1, 2, 3]);
  assert.deepEqual(p.s.tray, []);
  assert.deepEqual(keys(), before);
  const path = solve(p.s);
  assert.ok(path);
  for (const a of path) p.apply(a);
  assert.equal(p.won, true);
});
test("shuffle returns reserved tray card to stash without consuming its opportunity", () => {
  const p = basic();
  p.s.slotOpen = true;
  p.toggleStash();
  p.tap(0);
  p.toggleStash();
  p.tap(1);
  const ev = p.use("shuffle");
  assert.equal(ev[0].type, "shuffle");
  assert.equal(p.s.slot, 0);
  assert.equal(p.s.slotPending, 0);
  assert.equal(p.s.slotOpen, true);
  assert.equal(p.s.tiles[0].face, 0);
  assert.ok(solve(p.s));
});
test("save/restore rejects V1 and restores tray, reservation and undo costs", () => {
  const p = basic();
  p.tap(0);
  p.tap(3);
  p.use("undo");
  const data = p.export(),
    q = basic();
  assert.equal(q.restore(data), true);
  assert.deepEqual(q.s, p.s);
  q.use("undo");
  assert.equal(q.s.inventory.undo, 2);
  assert.deepEqual(q.s.tray, []);
  assert.equal(q.restore({ ...data, rulesVersion: 1 }), false);
});
test("uniform deterministic gift seeds keep negative branch near 15 percent", () => {
  let negative = 0;
  for (let i = 0; i < 10000; i++) {
    const seed = (i * 2654435761) >>> 0;
    if (((Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296 >= 0.85)
      negative++;
  }
  assert.ok(negative > 1400 && negative < 1600);
});

const beltGame = () => {
  const p = game(
    [
      tile(0, 0, 0, 0, 1),
      tile(1, 1, 0, 0, 0),
      tile(2, 2, 0, 0, -1),
      tile(3, 3, 0, 0, 2),
      tile(4, 3, 4, 0, 2),
      tile(5, 0, 10),
      tile(6, 1, 12),
      tile(7, 2, 14),
    ],
    24,
  );
  p.level.movement = {
    type: "belt",
    path: [0, 1, 2].map((x) => ({ x, y: 0, z: 1 })),
    tileIds: [0],
    laneLength: 3,
    direction: "right",
    periodMs: 6000,
    step: 0,
  };
  p.s.movement = clone(p.level.movement);
  p.s.tray = [5, 6, 7];
  return p;
};
test("periodic belt moves only on explicit timer, wraps within its lane, and a wait opens a solvable position", () => {
  const p = beltGame();
  assert.equal(free(p.s, p.s.tiles[0]), false);
  const path = solve(p.s, 60000, 1000);
  assert.ok(path);
  assert.equal(path[0].type, "wait");
  for (const a of path) p.apply(a);
  assert.ok(p.won);
  assert.equal(p.s.movement!.step, 1);
  const q = beltGame();
  for (let i = 0; i < 3; i++) q.advanceBelt();
  assert.equal(q.s.tiles[0].x, 0);
  assert.equal(q.s.movement!.step, 3);
  const hint = beltGame().use("hint")[0];
  assert.equal(hint.type, "hint");
  assert.deepEqual(hint.ids, []);
  assert.match(hint.text!, /等待传送带/);
});
test("belt supports four fixed directions and undo preserves elapsed phase", () => {
  for (const direction of ["right", "left", "up", "down"] as const) {
    const p = beltGame(),
      m = p.s.movement!;
    if (m.type !== "belt") throw Error();
    m.direction = direction;
    if (direction === "up" || direction === "down")
      m.path = [0, 1, 2].map((y) => ({ x: 0, y, z: 1 }));
    p.advanceBelt();
    assert.equal(
      direction === "up" || direction === "down"
        ? p.s.tiles[0].y
        : p.s.tiles[0].x,
      direction === "up" || direction === "left" ? 2 : 1,
    );
  }
  const p = beltGame();
  p.tap(4);
  p.advanceBelt();
  p.use("undo");
  assert.deepEqual(p.s.tray, [5, 6, 7]);
  assert.equal(p.s.movement!.step, 1);
  assert.equal(p.s.tiles[0].x, 1);
  const q = beltGame();
  assert.ok(q.restore(p.export()));
  assert.deepEqual(q.s.movement, p.s.movement);
});
const bonusGame = () => {
  const p = game(
    [0, 0, 1, 1, 2, 2, 3, 3].map((f, i) => tile(i, f)),
    24,
  );
  p.s.unbelievableCount = 2;
  return p;
};
test("two Unbelievable milestones are earned monotonically, undo cannot farm another popup or bonus", () => {
  const p = game(
    Array.from({ length: 64 }, (_, i) => tile(i, Math.floor(i / 2))),
    24,
  );
  for (let i = 0; i < 60; i += 2) p.apply({ type: "pair", a: i, b: i + 1 });
  assert.equal(p.s.unbelievableCount, 2);
  assert.deepEqual(p.s.unbelievableMilestones, [25, 30]);
  p.use("undo");
  p.tap(59);
  assert.equal(p.s.unbelievableCount, 2);
  assert.equal(p.startBonus()[0].type, "bonusSpawn");
  assert.deepEqual(p.startBonus(), []);
  const low = game([tile(0, 0), tile(1, 0)], 21);
  low.s.unbelievableCount = 2;
  assert.deepEqual(low.startBonus(), []);
});
test("timed gifts match only each other and use the same positive/negative reward logic", () => {
  for (const negative of [false, true]) {
    const p = bonusGame();
    p.startBonus();
    const ids = p.s.bonus!.ids,
      bonus = p.s.tiles.find((t) => t.id === ids[0])!;
    assert.equal(same(bonus, { ...tile(999, 0), kind: "gift" }), false);
    assert.ok(free(p.s, bonus));
    p.s.seed = negative ? negativeSeed() : 1;
    p.tap(ids[0]);
    const ev = p.tap(ids[1]);
    assert.equal(ev.find((e) => e.type === "gift")!.positive, !negative);
    assert.equal(p.s.bonus!.status, "claimed");
    assert.equal(p.history.length, 0);
    assert.equal(p.use("undo")[0].type, "notice");
    assert.deepEqual(p.startBonus(), []);
    assert.equal(p.won, false);
  }
});
test("bonus expiry removes both cards including one in the tray; undo/save never rewind its deadline", () => {
  const p = bonusGame();
  p.tap(0);
  p.startBonus();
  const ids = p.s.bonus!.ids;
  p.tap(ids[0]);
  p.tickBonus(5000);
  const q = bonusGame();
  assert.ok(q.restore(p.export()));
  assert.equal(q.s.bonus!.remainingMs, 7000);
  p.use("undo");
  assert.equal(p.s.bonus!.remainingMs, 7000);
  assert.ok(!p.s.tray.includes(ids[0]));
  p.tap(ids[0]);
  const ev = p.tickBonus(7000);
  assert.equal(ev[0].type, "bonusExpire");
  assert.ok(ids.every((id) => p.s.tiles.find((t) => t.id === id)!.removed));
  assert.ok(ids.every((id) => !p.s.tray.includes(id)));
  p.use("undo");
  assert.equal(p.s.bonus!.status, "expired");
  assert.ok(p.s.tiles.filter((t) => t.bonus).every((t) => t.removed));
  assert.deepEqual(p.startBonus(), []);
  assert.ok(q.restore(p.export()));
  assert.equal(q.s.bonus!.status, "expired");
});
test("bonus is optional for winning and the oracle accounts for held bonus capacity and expiry", () => {
  const p = bonusGame();
  p.startBonus();
  for (let i = 0; i < 8; i += 2) p.apply({ type: "pair", a: i, b: i + 1 });
  assert.ok(p.won);
  assert.equal(p.s.bonus!.status, "active");
  const q = bonusGame();
  q.startBonus();
  q.tap(q.s.bonus!.ids[0]);
  [0, 2, 4].forEach((id) => q.tap(id));
  assert.ok(q.full);
  const path = solve(q.s, 60000, 1000);
  assert.ok(path);
  assert.equal(path[0].type, "wait");
  for (const a of path) q.apply(a);
  assert.ok(q.won);
  assert.equal(q.s.bonus!.status, "expired");
});

function assertBonusPlacement(p: Puzzle) {
  const bonuses = p.s.tiles.filter((t) => t.bonus && onBoard(p.s, t));
  const overlap = (a: Tile, b: { x: number; y: number }) =>
    Math.abs(a.x - b.x) < 0.98 && Math.abs(a.y - b.y) < 0.98;
  for (const bonus of bonuses) {
    assert.ok(
      !p.s.tiles.some((t) => !t.bonus && onBoard(p.s, t) && overlap(bonus, t)),
      `bonus ${bonus.id} overlaps ordinary tile`,
    );
    assert.ok(
      !bonuses.some((t) => t.id !== bonus.id && overlap(bonus, t)),
      "bonus cards overlap",
    );
    const m = p.s.movement;
    if (m?.type === "conveyor" || m?.type === "lines")
      assert.ok(
        bonus.y < 0 ||
          !m.columns.some((_, i) => Math.abs(i * 1.2 - bonus.x) < 0.98),
        "bonus occupies future queue lane",
      );
    else if (m)
      assert.ok(
        !m.path.some((pos) => overlap(bonus, pos)),
        "bonus occupies future moving slot",
      );
  }
}
test("naturally earned level 28/30 bonuses relocate safely after undo and shuffle", async () => {
  const { makeLevels } = await import("../src/core/levels");
  for (const id of [28, 30]) {
    const p = new Puzzle(makeLevels()[id - 1]);
    for (const a of p.level.solution!) {
      p.apply(a);
      if ((p.s.unbelievableCount || 0) >= 2) break;
    }
    assert.equal(p.s.unbelievableCount, 2);
    assert.equal(p.won, false);
    assert.equal(p.startBonus()[0].type, "bonusSpawn");
    assertBonusPlacement(p);
    p.use("undo");
    assertBonusPlacement(p);
    p.use("undo");
    assertBonusPlacement(p);
    assert.equal(p.use("shuffle")[0].type, "shuffle");
    assertBonusPlacement(p);
    const q = new Puzzle(p.level);
    assert.ok(q.restore(p.export()));
    assertBonusPlacement(q);
  }
});
test("conveyor refill keeps gifts outside future lanes and moving boards never relocate a held bonus", () => {
  const p = conveyorGame();
  p.level.id = 24;
  p.s.levelId = 24;
  p.s.unbelievableCount = 2;
  p.startBonus();
  assertBonusPlacement(p);
  p.tap(0);
  p.tap(2);
  assertBonusPlacement(p);
  const q = beltGame();
  q.s.unbelievableCount = 2;
  q.startBonus();
  const id = q.s.bonus!.ids[0];
  q.tap(id);
  const before = clone(q.s.tiles.find((t) => t.id === id)!);
  q.advanceBelt();
  const after = q.s.tiles.find((t) => t.id === id)!;
  assert.deepEqual(after, before);
  assert.ok(q.s.tray.includes(id));
  assertBonusPlacement(q);
});

function experimentPuzzle(type: "dragon" | "slots" = "dragon", seed = 1) {
  return new Puzzle({
    id: 17,
    name: "experiment",
    subtitle: "",
    difficulty: 1,
    source: "test",
    seed,
    experiment: {
      type,
      threshold: type === "dragon" ? 2 : 3,
      maxActivations: 3,
      position: type === "dragon" ? "top" : "side",
    },
    tiles: Array.from({ length: 48 }, (_, i) => tile(i, Math.floor(i / 2))),
  });
}

test("experimental charge counts manual successful pairs only; unrelated picks reset the streak", () => {
  const p = experimentPuzzle();
  p.apply({ type: "pair", a: 0, b: 1 });
  assert.equal(p.s.experiment!.streak, 1);
  p.blast();
  assert.equal(p.s.experiment!.streak, 1);
  assert.equal(p.s.experiment!.activations, 0);
  p.tap(6);
  p.tap(8);
  assert.equal(p.s.experiment!.streak, 0);
  p.tap(7);
  assert.equal(p.s.experiment!.streak, 1);
  p.use("magnet");
  assert.equal(p.s.experiment!.streak, 0);
  assert.equal(p.s.experiment!.activations, 0);
});

test("manual bomb pair charges once despite collecting multiple automatic pairs", () => {
  const p = experimentPuzzle();
  p.s.tiles[0].kind = p.s.tiles[1].kind = "bomb";
  const events = p.apply({ type: "pair", a: 0, b: 1 });
  assert.equal(events.filter((e) => e.type === "match").length, 3);
  assert.equal(p.s.experiment!.streak, 1);
  assert.equal(p.s.experiment!.activations, 0);
});

test("experiment results use legal board pairs, bounded fire and exact inventory receipt counts", () => {
  const seen = new Set<string>();
  for (let index = 0; index < 180; index++) {
    const p = experimentPuzzle(
      index % 2 ? "slots" : "dragon",
      Math.imul(index + 1, 2654435761) >>> 0,
    );
    p.s.experiment!.streak = p.s.experiment!.threshold - 1;
    const before = clone(p.s.inventory);
    const events = p.apply({ type: "pair", a: 0, b: 1 }),
      e = events.find((e) => e.type === "experiment")!;
    assert.ok(e);
    seen.add(e.result!);
    assert.equal(p.s.experiment!.activations, 1);
    assert.equal(p.s.experiment!.streak, 0);
    assert.ok(
      !events.some((e) => e.type === "shuffle"),
      "random reward never forces shuffle",
    );
    if (e.result === "pairMove" || e.result === "pairBomb") {
      assert.equal(e.ids!.length, 2);
      assert.ok(e.boardBefore && e.boardAfter);
      for (const id of e.ids!) {
        assert.ok(free(p.s, p.s.tiles[id]));
        assert.equal(e.boardBefore!.tiles[id].kind, "normal");
        assert.equal(p.s.tiles[id].hidden, false);
      }
      assert.ok(same(p.s.tiles[e.ids![0]], p.s.tiles[e.ids![1]]));
    } else if (e.result === "fire") {
      const bomb = events.find((e) => e.type === "bomb")!;
      assert.equal(bomb.ids!.length, 2);
      assert.equal(bomb.actor, "dragon");
      assert.equal(events.filter((e) => e.type === "match").length, 2);
    } else if (e.result === "iq") {
      assert.ok([10, 20].includes(e.amount!));
      assert.equal(p.s.bonusIQ, e.amount);
    } else {
      const gift = events.find((e) => e.type === "gift")!;
      const reward = gift.reward as "hint" | "undo" | "magnet" | "shuffle";
      assert.equal(gift.rewardCountBefore, before[reward]);
      assert.equal(gift.rewardCountAfter, p.s.inventory[reward]);
      assert.deepEqual(gift.inventoryBefore, before);
      assert.deepEqual(gift.inventoryAfter, p.s.inventory);
    }
  }
  assert.deepEqual([...seen].sort(), [
    "fire",
    "hint",
    "iq",
    "magnet",
    "pairBomb",
    "pairMove",
    "shuffle",
    "undo",
  ]);
});

test("slot +2 rewards are rare independent outcomes; experiments stop after three activations", () => {
  let double = 0;
  for (let index = 0; index < 500; index++) {
    const p = experimentPuzzle("slots", Math.imul(index + 1, 2654435761) >>> 0);
    p.s.experiment!.streak = 2;
    const event = p
      .apply({ type: "pair", a: 0, b: 1 })
      .find((e) => e.type === "experiment")!;
    if (
      event.result !== "pairMove" &&
      event.result !== "pairBomb" &&
      (event.amount === 2 || event.amount === 20)
    )
      double++;
  }
  assert.ok(double > 8 && double < 55, `rare doubles ${double}`);
  const p = experimentPuzzle();
  for (let step = 0; step < 100 && !p.won; step++) {
    const a = p.s.tiles.find((t) => free(p.s, t));
    if (!a) break;
    const b = p.s.tiles.find(
      (t) => t.id !== a.id && free(p.s, t) && same(a, t),
    );
    if (!b) break;
    p.apply({ type: "pair", a: a.id, b: b.id });
  }
  assert.equal(p.s.experiment!.activations, 3);
  assert.equal(p.s.experiment!.streak, 0);
});

test("experimental rewards restore deterministically across save and undo, without farming inventory", () => {
  const p = experimentPuzzle("slots", 21999);
  p.apply({ type: "pair", a: 0, b: 1 });
  p.apply({ type: "pair", a: 2, b: 3 });
  p.tap(4);
  const checkpoint = p.export(),
    events = p.tap(5),
    after = clone(p.s);
  const restored = experimentPuzzle("slots", 21999);
  assert.ok(restored.restore(p.export()));
  assert.deepEqual(restored.s, p.s);
  p.use("undo");
  assert.equal(p.s.experiment!.activations, 0);
  const again = p.tap(5);
  assert.deepEqual(again, events);
  assert.equal(p.s.seed, after.seed);
  assert.equal(p.s.experiment!.activations, 1);
  assert.equal(p.s.inventory.undo, after.inventory.undo - 1);
  const before = experimentPuzzle("slots", 21999);
  assert.ok(before.restore(checkpoint));
  assert.deepEqual(before.tap(5), events);
  const corrupt = restored.export();
  corrupt.state.experiment!.activations = 99;
  assert.equal(restored.restore(corrupt), false);
});

test("reversible ring sends special pairs backwards, supports negative phases and exact undo/save", () => {
  const p = new Puzzle({
    id: 20,
    name: "reversible",
    subtitle: "",
    difficulty: 3,
    source: "test",
    seed: 1,
    tiles: Array.from({ length: 8 }, (_, i) =>
      tile(i, Math.floor(i / 2), i * 2, 0, 0, i < 2 ? "move" : "normal"),
    ),
    movement: {
      type: "ring",
      reversible: true,
      step: 0,
      tileIds: [0, 1, 2, 3, 4, 5, 6, 7],
      path: Array.from({ length: 8 }, (_, i) => ({ x: i * 2, y: 0, z: 0 })),
    },
  });
  const events = p.apply({ type: "pair", a: 0, b: 1 });
  assert.equal(p.s.movement!.step, -1);
  assert.equal(events.find((e) => e.type === "boardMove")!.step, -1);
  const restored = new Puzzle(p.level);
  assert.ok(restored.restore(p.export()));
  assert.deepEqual(restored.s, p.s);
  p.apply({ type: "pair", a: 2, b: 3 });
  assert.equal(p.s.movement!.step, 0);
  p.use("undo");
  assert.equal(p.s.movement!.step, -1);
});

test("extra move pairs bank unlocks; reserved match relocks and only a later click spends a charge", () => {
  const p = experimentPuzzle();
  delete p.s.experiment;
  delete p.level.experiment;
  for (const id of [0, 1, 2, 3]) p.s.tiles[id].kind = "move";
  p.apply({ type: "pair", a: 0, b: 1 });
  assert.equal(p.s.slotOpen, true);
  p.toggleStash();
  p.tap(4);
  assert.equal(p.s.slotPending, 4);
  const bank = p
    .apply({ type: "pair", a: 2, b: 3 })
    .find((e) => e.type === "unlock")!;
  assert.equal(bank.stashCharges, 1);
  assert.equal(p.s.stashCharges, 1);
  p.apply({ type: "pair", a: 4, b: 5 });
  assert.equal(p.s.slotOpen, false);
  assert.equal(p.s.stashCharges, 1);
  assert.equal(p.s.slotPending, null);
  const restored = new Puzzle(p.level);
  assert.ok(restored.restore(p.export()));
  assert.equal(restored.s.stashCharges, 1);
  p.toggleStash();
  assert.equal(p.s.slotOpen, true);
  assert.equal(p.s.stashCharges, 0);
  assert.equal(p.stashMode, true);
  p.use("undo");
  assert.equal(p.s.slotOpen, false);
  assert.equal(p.s.stashCharges, 1);
});

test("solver and apply can explicitly spend a banked stash without inventing an extra slot", () => {
  const p = experimentPuzzle();
  delete p.s.experiment;
  delete p.level.experiment;
  p.s.stashCharges = 1;
  for (const id of [0, 2, 4, 6]) p.tap(id);
  assert.ok(p.full);
  assert.equal(p.s.slotOpen, false);
  const plan = solve(p.s, 60000, 65);
  assert.ok(plan);
  assert.equal(plan[0].type, "stash");
  p.apply(plan[0]);
  assert.equal(p.s.stashCharges, 0);
  assert.equal(p.s.tray.length, 3);
  assert.notEqual(p.s.slot, null);
  assert.equal(p.s.slot, p.s.slotPending);
  for (const action of plan.slice(1)) p.apply(action);
  assert.ok(p.won);
});

test("empty bomb awards a visible hint receipt without bypassing capacity or side gates", () => {
  const p = experimentPuzzle();
  delete p.s.experiment;
  delete p.level.experiment;
  for (const t of p.s.tiles) t.hidden = true;
  const before = p.s.inventory.hint,
    events = p.blast();
  assert.deepEqual(events[0].ids, []);
  assert.equal(p.s.inventory.hint, before + 1);
  const receipt = events.find((e) => e.type === "gift")!;
  assert.equal(receipt.reward, "hint");
  assert.equal(receipt.rewardCountBefore, before);
  assert.equal(receipt.rewardCountAfter, before + 1);
  assert.ok(p.s.tiles.every((t) => !t.removed));
  for (const id of [0, 2, 4]) {
    p.s.tiles[id].hidden = false;
    p.tap(id);
  }
  const blockedBefore = p.s.inventory.hint;
  p.blast();
  assert.equal(p.s.inventory.hint, blockedBefore);
});

function assertQueuePacked(p: Puzzle) {
  const m = p.s.movement;
  assert.ok(m?.type === "conveyor" || m?.type === "lines");
  if (m.type !== "conveyor" && m.type !== "lines") throw Error();
  for (const [c, ids] of m.columns.entries()) {
    const board = ids
      .map((id) => p.s.tiles.find((t) => t.id === id)!)
      .filter((t) => onBoard(p.s, t));
    assert.equal(m.frontIds[c], board[0]?.id ?? null);
    board.forEach((t, depth) => {
      assert.equal(t.y, m.type === "lines" ? 5 - depth : depth);
      assert.equal(queueDepth(p.s, t), depth);
      assert.equal(free(p.s, t), depth === 0);
    });
  }
}
function lineFixture(faces: number[][]): Puzzle {
  let id = 0;
  const columns = faces.map((c) => c.map(() => id++));
  return new Puzzle({
    id: 31,
    name: "lines fixture",
    subtitle: "",
    source: "test",
    seed: 7,
    difficulty: 1,
    tiles: columns.flatMap((ids, c) =>
      ids.map((id, d) => tile(id, faces[c][d], c * 1.2, 5 - d)),
    ),
    movement: {
      type: "lines",
      columns,
      frontIds: columns.map((c) => c[0]),
      rows: 6,
      target: 2,
      cleared: 0,
      step: 0,
    },
  });
}

test("buried magnet removal followed by one unmatched conveyor pick never leaves holes; stash and restore agree", () => {
  const p = game([
    tile(0, 3, 0, 0),
    tile(1, 0, 0, 1),
    tile(2, 0, 0, 2),
    tile(3, 1, 0, 3),
    tile(4, 2, 1.2, 0),
    tile(5, 4, 1.2, 1),
    tile(6, 4, 1.2, 2),
    tile(7, 1, 1.2, 3),
  ]);
  p.level.movement = {
    type: "conveyor",
    columns: [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ],
    frontIds: [0, 4],
    step: 0,
  };
  p.s.movement = clone(p.level.movement);
  p.s.levelId = p.level.id;
  const magnet = p.use("magnet");
  assert.deepEqual(magnet[0].ids, [1, 2]);
  assertQueuePacked(p);
  const ev = p.tap(0);
  assert.equal(p.s.matches, 1);
  assert.deepEqual(p.s.tray, [0]);
  assert.ok(
    ev.some(
      (e) =>
        e.type === "boardMove" &&
        e.positions?.some((pos) => pos.id === 3 && pos.to.y === 0),
    ),
  );
  assertQueuePacked(p);
  const restored = new Puzzle(p.level);
  assert.ok(restored.restore(p.export()));
  assertQueuePacked(restored);
  const obsolete = p.export();
  obsolete.rulesVersion = 4;
  assert.equal(restored.restore(obsolete), true);
  assertQueuePacked(restored);
  p.use("undo");
  assertQueuePacked(p);
  assert.equal(p.s.tiles[3].y, 1);
  p.s.slotOpen = true;
  p.toggleStash();
  const stash = p.tap(0);
  assert.ok(stash.some((e) => e.type === "boardMove"));
  assertQueuePacked(p);
  assert.equal(p.s.tiles[3].y, 0);
});

test("conveyor blast uses immediate per-card gravity and keeps every remaining front legal", () => {
  const p = conveyorGame();
  const ev = p.blast(2);
  assert.ok(ev.filter((e) => e.type === "collect").length >= 2);
  assertQueuePacked(p);
  const first = ev.findIndex((e) => e.type === "collect");
  assert.equal(ev[first + 1].type, "boardMove");
  assert.ok(ev[first + 1].boardBefore && ev[first + 1].boardAfter);
});

test("line experiment is finite, normal-only and starts without a completed line", () => {
  const p = new Puzzle(makeLineLevel()),
    m = p.s.movement!;
  assert.equal(m.type, "lines");
  if (m.type !== "lines") throw Error();
  assert.equal(p.s.tiles.length, 48);
  assert.equal(m.columns.length, 6);
  assert.equal(p.s.tiles.filter((t) => t.y >= 0).length, 36);
  assert.equal(p.s.tiles.filter((t) => t.y < 0).length, 12);
  assert.ok(
    p.s.tiles.every((t) => t.kind === "normal" && !t.hidden && !t.everHidden),
  );
  for (const face of new Set(p.s.tiles.map((t) => t.face)))
    assert.equal(p.s.tiles.filter((t) => t.face === face).length % 2, 0);
  assert.equal(nextCompleteLine(p.s), null);
  assertQueuePacked(p);
  assert.equal(p.tap(33)[0].type, "blocked");
  p.s.unbelievableCount = 2;
  assert.deepEqual(p.startBonus(), []);
});

test("one unmatched bottom pick creates a six-card row, and each cascade refills down without pair inflation", () => {
  const p = new Puzzle(makeLineLevel());
  const ev = p.tap(32),
    line = ev.find((e) => e.type === "lineClear")!;
  assert.ok(line);
  assert.equal(line.orientation, "row");
  assert.equal(line.lineIndex, 5);
  assert.equal(line.ids!.length, 6);
  assert.equal(line.clearedCount, 1);
  assert.equal(line.target, 2);
  assert.ok(!line.ids!.includes(32));
  assert.deepEqual(p.s.tray, [32]);
  assert.equal(p.s.matches, 0);
  assert.equal(p.s.combo, 0);
  assert.equal(p.s.bestCombo, 0);
  assertQueuePacked(p);
  const before = clone(line.boardBefore),
    after = clone(line.boardAfter);
  const columnEvents = p.tap(1);
  assert.equal(
    columnEvents.find((e) => e.type === "lineClear")?.orientation,
    "column",
  );
  assert.equal(p.s.movement!.type === "lines" && p.s.movement!.cleared, 2);
  assert.equal(p.s.matches, 1);
  assert.equal(p.s.combo, 1);
  assert.deepEqual(p.s.tray, []);
  assertQueuePacked(p);
  assert.deepEqual(line.boardBefore, before);
  assert.deepEqual(line.boardAfter, after);
  assert.ok(!p.won, "quota alone is insufficient while ordinary cards remain");
});

test("crosses clear rows before columns, rescan after gravity, and remove six plus six rather than eleven", () => {
  const faces = Array.from({ length: 6 }, (_, c) =>
    Array.from({ length: c === 0 ? 7 : 6 }, (_, d) =>
      c === 0 || d === 0 ? 0 : 10 + c + d * 6,
    ),
  );
  const p = lineFixture(faces),
    events = settleBoard(p.s),
    lines = events.filter((e) => e.type === "lineClear");
  assert.deepEqual(
    lines.map((e) => e.orientation),
    ["row", "column"],
  );
  assert.deepEqual(
    lines.map((e) => e.ids!.length),
    [6, 6],
  );
  assert.equal(new Set(lines.flatMap((e) => e.ids!)).size, 12);
  assert.ok(!lines[0].ids!.includes(6), "reserve excluded from the first row");
  assert.ok(
    lines[1].ids!.includes(6),
    "refill made the queued card visible before the column scan",
  );
  assert.equal(p.s.tiles.filter((t) => t.removed).length, 12);
  assert.equal(p.s.matches, 0);
  assert.equal(p.s.combo, 0);
  assertQueuePacked(p);
});

test("partial crosses, hidden/special cards, reserves and held cards cannot form phantom lines", () => {
  const faces = Array.from({ length: 6 }, (_, c) =>
    Array.from({ length: 6 }, (_, d) =>
      c === 0 || d === 0 ? 0 : 10 + c + d * 6,
    ),
  );
  const cross = lineFixture(faces);
  assert.equal(
    settleBoard(cross.s).filter((e) => e.type === "lineClear").length,
    1,
  );
  assert.equal(cross.s.tiles.filter((t) => t.removed).length, 6);
  for (const mode of ["hidden", "special", "tray", "slot"]) {
    const p = lineFixture(
      Array.from({ length: 6 }, (_, c) => [
        0,
        10 + c,
        20 + c,
        30 + c,
        40 + c,
        50 + c,
        0,
      ]),
    );
    const t = p.s.tiles[0];
    if (mode === "hidden") t.hidden = true;
    if (mode === "special") t.kind = "move";
    if (mode === "tray") p.s.tray.push(t.id);
    if (mode === "slot") p.s.slot = t.id;
    assert.equal(nextCompleteLine(p.s), null, mode);
  }
});

test("line stashing and magnet use the same gravity and line pipeline", () => {
  const stash = new Puzzle(makeLineLevel());
  stash.s.slotOpen = true;
  stash.toggleStash();
  const stashed = stash.tap(32);
  assert.ok(stashed.some((e) => e.type === "lineClear"));
  assert.equal(stash.s.slot, 32);
  assertQueuePacked(stash);
  const p = new Puzzle(makeLineLevel());
  // A buried B and the bottom B are selected by magnet without entering the tray.
  p.s.tiles.sort(
    (a, b) => Number(![32, 1].includes(a.id)) - Number(![32, 1].includes(b.id)),
  );
  const ev = p.use("magnet");
  assert.deepEqual(new Set(ev[0].ids), new Set([32, 1]));
  assert.ok(ev.some((e) => e.type === "lineClear"));
  assert.equal(p.s.matches, 1);
  assert.deepEqual(p.s.tray, []);
  assertQueuePacked(p);
});

test("line quota, finite reserves and cascades survive undo/save; corrupted quota/holes fail restore", () => {
  const level = makeLineLevel(),
    p = new Puzzle(level),
    q = new Puzzle(level),
    start = clone(p.s);
  p.tap(32);
  assert.ok(q.restore(p.export()));
  assert.deepEqual(q.s, p.s);
  const bad = p.export();
  if (bad.state.movement?.type === "lines") bad.state.movement.cleared++;
  assert.equal(q.restore(bad), false);
  const hole = p.export();
  hole.state.tiles.find((t) => onBoard(hole.state, t))!.y--;
  assert.equal(q.restore(hole), false);
  p.use("undo");
  assert.deepEqual(p.s.tiles, start.tiles);
  assert.deepEqual(p.s.movement, start.movement);
  assert.deepEqual(p.s.tray, []);
  assertQueuePacked(p);
});

test("line hints plan for quota, while an empty board with a missed quota is observable and never solved", () => {
  const p = new Puzzle(makeLineLevel());
  assert.deepEqual(p.use("hint").find((e) => e.type === "hint")?.ids, [32]);
  p.tap(32);
  assert.deepEqual(p.use("hint").find((e) => e.type === "hint")?.ids, [1]);
  const bad = new Puzzle(makeLineLevel());
  for (const action of lineData.missedGoalSolution)
    bad.apply(action as import("../src/core/model").Action);
  assert.ok(bad.goalFailed);
  assert.ok(!bad.won);
  assert.equal(live(bad.s).length, 0);
  assert.equal(solve(bad.s, 60000, 1000), null);
  const balance = bad.s.inventory.hint;
  assert.ok(bad.use("hint").every((e) => e.type !== "hint"));
  assert.equal(bad.s.inventory.hint, balance);
  const q = new Puzzle(makeLineLevel());
  assert.ok(q.restore(bad.export()));
  assert.ok(q.goalFailed);
  assert.ok(bad.use("undo").some((e) => e.type === "undo"));
  assert.ok(!bad.goalFailed);
});

test("line recovery shuffle preserves the face multiset across its six-card clears and yields a real winning path", () => {
  const p = new Puzzle(makeLineLevel());
  p.tap(0);
  p.tap(8);
  const original = clone(p.s),
    counts = (tiles: Tile[]) => tiles.map((t) => t.face).sort((a, b) => a - b);
  const ev = p.use("shuffle");
  assert.equal(ev[0].type, "shuffle");
  const cleared = new Set(
    ev.filter((e) => e.type === "lineClear").flatMap((e) => e.ids!),
  );
  assert.deepEqual(
    counts(live(p.s).concat(p.s.tiles.filter((t) => cleared.has(t.id)))),
    counts(live(original)),
  );
  assertQueuePacked(p);
  const path = solve(p.s, 60000, 1000);
  assert.ok(path);
  for (const a of path) p.apply(a);
  assert.ok(p.won);
  const q = new Puzzle(makeLineLevel());
  q.s = clone(original);
  const first = q.use("shuffle");
  assert.equal(first[0].type, "shuffle");
  q.use("undo");
  assert.deepEqual(q.s.tiles, original.tiles);
  assert.deepEqual(q.s.movement, original.movement);
});

test("V4 conveyor save migrates a legacy vacant front and undo history without changing rewards or PRNG", () => {
  const p = conveyorGame(),
    old = p.export();
  old.rulesVersion = 4;
  old.history = [clone(old.state)];
  old.costs = [{ undo: 0, hint: 0 }];
  old.state.tray = [0];
  old.state.moves = 1; // old engine left id 1 at depth one, frontIds[0] at held id 0
  const immutable = clone(old),
    q = conveyorGame();
  assert.ok(q.restore(old));
  assert.deepEqual(old, immutable);
  assertQueuePacked(q);
  assert.deepEqual(q.s.tray, [0]);
  assert.equal(q.s.tiles[1].y, 0);
  assert.equal(q.s.matches, 0);
  assert.equal(q.s.score, 0);
  assert.equal(q.s.seed, old.state.seed);
  assert.deepEqual(q.s.inventory, old.state.inventory);
  assert.equal(q.history.length, 1);
  q.use("undo");
  assert.equal(q.s.tiles[1].y, 1);
  assert.deepEqual(q.s.tray, []);
  assertQueuePacked(q);
  const corrupt = clone(old);
  corrupt.state.tiles[1].y = 2;
  assert.equal(q.restore(corrupt), false);
});

test("queued blocked feedback follows the current front after collection and line cascades", () => {
  const p = new Puzzle(makeLineLevel());
  p.tap(32);
  assert.deepEqual(p.tap(35).find((e) => e.type === "blocked")?.ids, [34]);
  const q = conveyorGame();
  q.s.tiles.push(tile(6, 3, 0, 2));
  if (q.s.movement?.type === "conveyor") q.s.movement.columns[0].push(6);
  q.tap(0);
  assert.deepEqual(q.tap(6).find((e) => e.type === "blocked")?.ids, [1]);
});
