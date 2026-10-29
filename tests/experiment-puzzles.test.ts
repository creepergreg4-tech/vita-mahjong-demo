import test from "node:test";
import assert from "node:assert/strict";
import { Puzzle, experimentClearActions } from "../src/core/rules";
import { makeLevels, tile } from "../src/core/levels";
import { clone, free, same, type Event, type State } from "../src/core/model";
import { solve } from "../src/core/solver";

function puzzle(type: "dragon" | "slots" = "dragon") {
  return new Puzzle({ id: 26, name: "stacks", subtitle: "", difficulty: 1,
    source: "test", seed: 27,
    experiment: { type, threshold: type === "dragon" ? 2 : 3, maxActivations: 3, position: "top" },
    tiles: Array.from({ length: 24 }, (_, i) => tile(i, (i % 6) * 2, Math.floor(i / 6) * 2, 0, Math.floor(i / 2))),
  });
}
function trigger(p: Puzzle, a = 0, b = 1): Event[] {
  p.tap(a);
  p.s.experiment!.streak = p.s.experiment!.threshold - 1;
  return p.tap(b);
}
function parity(s: State) {
  const counts = new Map<string, number>();
  for (const t of s.tiles.filter((t) => !t.removed && !t.bonus)) {
    const key = `${t.kind}:${t.kind === "normal" ? t.face : 0}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  assert.ok([...counts.values()].every((n) => n % 2 === 0));
}
export function clearDeliveries(p: Puzzle): number {
  let steps = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const path = experimentClearActions(p.s);
    assert.ok(path, "ordinary output has a local certificate");
    if (!path.length) return steps;
    for (const a of path) {
      assert.ok(free(p.s, p.s.tiles.find((t) => t.id === a.a)!));
      assert.ok(!p.full);
      p.apply(a);
      parity(p.s);
      steps++;
    }
  }
  assert.fail("finite delivery limit exceeded");
}

for (const type of ["dragon", "slots"] as const) {
  test(`${type}: first output is six real ordinary tiles with different free tops`, () => {
    const p = puzzle(type), before = p.s.tiles.length;
    const event = trigger(p).find((e) => e.type === "experiment")!;
    assert.equal(event.result, "stackNormal");
    assert.equal(event.amount, 6);
    assert.equal(p.s.tiles.length, before + 6);
    assert.equal(event.boardBefore!.tiles.length, before);
    assert.equal(event.boardAfter!.tiles.length, before + 6);
    assert.equal(new Set(event.previewFaces).size, 3);
    const output = p.s.tiles.filter((t) => event.ids!.includes(t.id));
    const tops = output.filter((t) => free(p.s, t));
    assert.equal(tops.length, 2);
    assert.ok(!same(tops[0], tops[1]));
    assert.ok(output.every((t) => t.kind === "normal" && !t.bonus));
    parity(p.s);
    assert.equal(experimentClearActions(p.s)!.length, 6);
    clearDeliveries(p);
    assert.ok(event.ids!.every((id) => p.s.tiles.find((t) => t.id === id)!.removed));
  });
}

test("unsafe occupied tray defers without consuming activation; safe output preserves held faces", () => {
  const p = puzzle();
  p.s.tray = [2, 4];
  const events = trigger(p), seed = p.s.seed;
  assert.ok(!events.some((e) => e.type === "experiment"));
  assert.equal(p.s.experiment!.activations, 0);
  assert.equal(p.s.experiment!.streak, 1);
  const emitted = p.tap(3).find((e) => e.result === "stackNormal")!;
  assert.ok(emitted);
  assert.equal(emitted.previewFaces!.includes(p.s.tiles[4].face), false);
  assert.notEqual(p.s.seed, seed);
  clearDeliveries(p);
  assert.deepEqual(p.s.tray, [4]);
});

test("stack save, tamper rejection and undo restore tile count, metadata and deterministic output", () => {
  const p = puzzle();
  p.tap(0);
  p.s.experiment!.streak = 1;
  const before = clone(p.s), events = p.tap(1), saved = p.export();
  const q = puzzle();
  assert.ok(q.restore(saved));
  assert.deepEqual(q.s, p.s);
  for (const mutate of [
    (s: State) => { s.experiment!.batches![0].ids[0]++; },
    (s: State) => { s.tiles.at(-1)!.z++; },
    (s: State) => { s.tiles.at(-1)!.face = 100; },
    (s: State) => { s.experiment!.batches![0].activation = 4; },
  ]) {
    const corrupt = clone(saved); mutate(corrupt.state);
    assert.equal(q.restore(corrupt), false);
  }
  p.use("undo");
  assert.equal(p.s.tiles.length, before.tiles.length);
  assert.deepEqual(p.s.experiment, before.experiment);
  assert.deepEqual(p.tap(1), events);
});

test("reserved timed bonus IDs survive either delivery order and undo", () => {
  for (const bonusFirst of [true, false]) {
    const p = puzzle(); p.s.unbelievableCount = 2;
    if (bonusFirst) p.startBonus();
    trigger(p);
    if (!bonusFirst) p.startBonus();
    assert.deepEqual(p.s.bonus!.ids, [24, 25]);
    assert.deepEqual(p.s.experiment!.batches![0].ids, [26, 27, 28, 29, 30, 31]);
    assert.equal(new Set(p.s.tiles.map((t) => t.id)).size, p.s.tiles.length);
    assert.ok(puzzle().restore(p.export()));
    p.use("undo");
    assert.ok(puzzle().restore(p.export()));
  }
});

test("shuffle and undo preserve finite batch identity and a valid save", () => {
  const p = puzzle(); trigger(p);
  const before = clone(p.s.experiment);
  const event = p.use("shuffle");
  assert.ok(event.some((e) => e.type === "shuffle"));
  assert.deepEqual(p.s.experiment!.batches, before!.batches);
  assert.ok(puzzle().restore(p.export()));
  parity(p.s);
  p.use("undo");
  assert.deepEqual(p.s.experiment, before);
  assert.ok(puzzle().restore(p.export()));
});

test("all four campaign machine levels have a certified actual-engine route including added stacks", () => {
  for (const level of makeLevels().filter((l) => l.experiment)) {
    const p = new Puzzle(level); let added = 0;
    const path = solve(p.s, 250000, 1500);
    assert.ok(path, `machine route ${level.id}`);
    for (const a of path) {
      if (p.s.experiment?.batches?.some((b) => b.ids.includes(a.a))) added++;
      p.apply(a);
      assert.ok(new Puzzle(level).restore(p.export()), `restore level ${level.id}`);
    }
    assert.ok(added >= 6 && added <= 18, `level ${level.id}: ${added} extra picks`);
    assert.ok(p.won, `level ${level.id} wins with ${added} extra picks`);
    assert.ok(p.s.experiment!.activations <= 3);
  }
});

test("dynamic solver and hint handle emitted IDs and certify a full clear", () => {
  const p = puzzle(); trigger(p);
  const path = solve(p.s, 100000, 2500);
  assert.ok(path);
  assert.ok(p.use("hint").some((e) => e.type === "hint"));
  for (const action of path) p.apply(action);
  assert.ok(p.won);
});

test("consuming a dynamic solution cannot truncate later hints or cached witnesses", () => {
  const p = puzzle(), original = clone(p.s);
  const first = solve(original, 100000, 2500)!;
  assert.ok(first.length);
  first.splice(0, first.length);
  const again = solve(original, 100000, 2500)!;
  assert.ok(again.length);
  for (const action of again) p.apply(action);
  assert.ok(p.won);
});
