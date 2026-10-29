import test from "node:test";
import assert from "node:assert/strict";
import { makeLevels, initial, specialPairCounts } from "../src/core/levels";
import { Puzzle } from "../src/core/rules";
import { solve } from "../src/core/solver";
import {
  free,
  exposed,
  onBoard,
  canStash,
  same,
  random,
  type Level,
  type Action,
  type Tile,
  type Event,
} from "../src/core/model";
const levels = makeLevels();
const runs = 32;
function campaignWitness(level: Level): Action[] {
  if (!level.experiment) return level.solution!;
  const path = solve(new Puzzle(level).s, 250000, 1500);
  assert.ok(path, `actual engine certificate for machine level ${level.id}`);
  return path;
}
/** Instrument the actual shared entry point, including nested blast/gift calls.
 * Checking emitted events after the pair vanished would miss illegal bypasses. */
function auditedPuzzle(level: Level) {
  const p = new Puzzle(level),
    audit = { boardCollections: 0, slotReturns: 0 };
  const internal = p as unknown as { collect: (t: Tile) => Event[] };
  const collect = internal.collect.bind(p);
  internal.collect = (t: Tile) => {
    assert.ok(!p.full, `capacity before collection ${level.id}:${t.id}`);
    assert.ok(!t.hidden, `hidden collection ${level.id}:${t.id}`);
    if (p.s.slot === t.id) audit.slotReturns++;
    else {
      assert.ok(
        free(p.s, t),
        `illegal side/cover collection ${level.id}:${t.id}`,
      );
      audit.boardCollections++;
    }
    return collect(t);
  };
  return Object.assign(p, { audit });
}
function checkedApply(p: Puzzle, a: Action) {
  const t = p.s.tiles.find((t) => t.id === a.a)!;
  if (a.type === "collect" && onBoard(p.s, t))
    assert.ok(
      free(p.s, t),
      `board action must be free BEFORE tap ${p.level.id}:${t.id}`,
    );
  if (a.type === "stash")
    assert.ok(
      canStash(p.s, t) ||
        (t.hidden &&
          exposed(p.s, t) &&
          p.s.slotOpen &&
          p.s.slot === null &&
          p.s.slotPending === null),
      `illegal stash ${p.level.id}:${t.id}`,
    );
  return p.apply(a);
}
function policy(level: Level, seed: number) {
  const p = auditedPuzzle(level),
    rng = { seed };
  p.save = () => {}; // No undo in this benchmark.
  let exploration = 0,
    stashes = 0;
  for (let step = 0; step < 400 && !p.won; step++) {
    const held = p.s.tray.map((id) => p.s.tiles.find((t) => t.id === id)!);
    if (p.full) {
      const options = held.filter((t) => canStash(p.s, t));
      if (!options.length) break;
      p.apply({
        type: "stash",
        a: options[Math.floor(random(rng) * options.length)].id,
      });
      stashes++;
      continue;
    }
    // A face reveal costs no capacity: inspect all accessible information before
    // choosing what to collect. This is an explicit tap, never an automatic flip.
    const blue = p.s.tiles.find(
      (t) => onBoard(p.s, t) && exposed(p.s, t) && t.hidden,
    );
    if (blue) {
      p.tap(blue.id);
      continue;
    }
    let choices = p.s.tiles.filter(
      (t) =>
        !t.hidden &&
        (free(p.s, t) || (p.s.slot === t.id && held.some((h) => same(h, t)))),
    );
    const matches = choices.filter((t) => held.some((h) => same(h, t)));
    if (matches.length) choices = matches;
    else {
      const pairStarts =
        p.s.tray.length <= 2
          ? choices.filter((t) =>
              choices.some((o) => o.id !== t.id && same(t, o)),
            )
          : [];
      if (pairStarts.length) choices = pairStarts;
      else {
        const backs = p.s.tiles.filter((t) => free(p.s, t) && t.hidden);
        if (backs.length) {
          p.tap(backs[0].id);
          continue;
        }
        exploration++;
      }
    }
    if (!choices.length) break;
    p.apply({
      type: "collect",
      a: choices[Math.floor(random(rng) * choices.length)].id,
    });
  }
  return { won: p.won, exploration, rescued: p.won && stashes > 0 };
}

test("V3 has 30 dense boards with separate exposed and side-open collection criteria", () => {
  assert.equal(levels.length, 30);
  const shapes = new Set<string>();
  for (const level of levels) {
    const ts = level.tiles;
    assert.ok(
      /新编排 V[34]/.test(level.source) && level.source.includes("非原 APK"),
    );
    assert.equal(ts.length % 2, 0);
    assert.ok(ts.length >= 48 && ts.length <= 110);
    if (level.id >= 3 && level.id <= 6)
      assert.ok(ts.length >= 60 && ts.length <= 80);
    if (level.id >= 7) assert.ok(ts.length >= 70);
    assert.ok(
      Math.max(...ts.map((t) => t.x)) - Math.min(...ts.map((t) => t.x)) <= 5.1,
    );
    if (level.movement?.type !== "conveyor") {
      assert.ok(Math.max(...ts.map((t) => t.y)) <= 7.5);
      assert.ok(new Set(ts.map((t) => t.z)).size >= 4);
    } else {
      assert.equal(level.movement.columns.length, 5);
      assert.ok(level.movement.columns.every((c) => c.length >= 14));
    }
    const s = initial(ts, level.seed, level.movement),
      surface = ts.filter((t) => exposed(s, t)),
      opening = ts.filter((t) => free(s, t));
    assert.ok(
      level.movement?.type === "conveyor"
        ? surface.length === 5
        : level.movement?.type === "ring"
          ? surface.length >= 24 && surface.length <= 36
          : surface.length >= 12 && surface.length <= 22,
      `${level.id} exposed ${surface.length}`,
    );
    assert.ok(
      opening.length >= 4 && opening.length <= surface.length,
      `${level.id} collectable ${opening.length}`,
    );
    let matching = 0;
    for (let a = 0; a < opening.length; a++)
      for (let b = a + 1; b < opening.length; b++)
        matching += Number(same(opening[a], opening[b]));
    assert.ok(matching >= (level.movement?.type === "conveyor" ? 1 : 2));
    const key = ts
      .map((t) => `${t.x},${t.y},${t.z}`)
      .sort()
      .join(";");
    assert.ok(!shapes.has(key), `duplicate geometry ${level.id}`);
    shapes.add(key);
    for (let i = 0; i < ts.length; i++)
      for (let j = i + 1; j < ts.length; j++)
        if (ts[i].z === ts[j].z)
          assert.ok(
            Math.abs(ts[i].x - ts[j].x) >= 0.98 ||
              Math.abs(ts[i].y - ts[j].y) >= 0.98,
            `same-layer overlap ${level.id}:${i}/${j}`,
          );
    for (const [kind, intro] of [
      ["move", 2],
      ["bomb", 7],
      ["gift", 13],
    ] as const)
      assert.equal(
        ts.filter((t) => t.kind === kind).length,
        specialPairCounts(level.id)[kind] * 2,
      );
    const normal = ts.filter((t) => t.kind === "normal"),
      faces = new Set(normal.map((t) => t.face));
    assert.ok(faces.size >= 10 && faces.size <= 22);
    assert.ok(normal.every((t) => t.face >= 0 && t.face < 42));
  }
});

test("V3 runtime loads static boards quickly with fresh four-slot state", () => {
  const start = performance.now();
  const a = makeLevels(),
    b = makeLevels();
  assert.ok(performance.now() - start < 500);
  a[0].tiles[0].removed = true;
  assert.equal(b[0].tiles[0].removed, false);
  const s = initial(b[0].tiles);
  assert.deepEqual(s.tray, []);
  assert.equal(s.slotPending, null);
});

test("initial blue backs begin at level 5 and deterministically mark only buried ordinary cards", () => {
  const again = makeLevels();
  for (const level of levels) {
    const s = initial(level.tiles, level.seed, level.movement),
      backs = level.tiles.filter((t) => t.hidden);
    const expected =
      level.id < 5
        ? 0
        : level.id === 5
          ? 4
          : Math.min(12, Math.round(level.tiles.length * 0.12));
    assert.equal(backs.length, expected, `level ${level.id} blue count`);
    assert.ok(
      backs.every((t) => t.kind === "normal" && t.everHidden && !exposed(s, t)),
    );
    assert.deepEqual(
      backs.map((t) => t.id),
      again[level.id - 1].tiles.filter((t) => t.hidden).map((t) => t.id),
    );
  }
});

test("a buried initial back rejects input, persists after uncovering, then requires reveal and collection taps", () => {
  const level = levels[4],
    p = new Puzzle(level),
    back = p.s.tiles.find((t) => t.hidden)!;
  const blocked = p.tap(back.id);
  assert.equal(blocked[0].type, "blocked");
  assert.equal(p.s.moves, 0);
  assert.equal(back.hidden, true);
  assert.equal(canStash(p.s, back), false);
  for (const a of level.solution!) {
    if (exposed(p.s, back)) break;
    assert.notEqual(a.a, back.id);
    p.apply(a);
  }
  assert.ok(exposed(p.s, back));
  assert.equal(back.hidden, true);
  assert.ok(!p.s.tray.includes(back.id));
  const before = [...p.s.tray],
    moves = p.s.moves;
  const reveal = p.tap(back.id);
  assert.deepEqual(
    reveal.map((e) => e.type),
    ["flip"],
  );
  assert.equal(back.hidden, false);
  assert.equal(back.everHidden, true);
  assert.deepEqual(p.s.tray, before);
  assert.equal(p.s.moves, moves + 1);
  if (free(p.s, back)) {
    const collect = p.tap(back.id);
    assert.ok(collect.some((e) => e.type === "collect"));
    assert.equal(p.s.moves, moves + 2);
  } else {
    const blocked = p.tap(back.id);
    assert.equal(blocked[0].type, "blocked");
    assert.equal(p.s.moves, moves + 1);
  }
});

test("gift veil never re-hides a revealed initial blue card", () => {
  const p = new Puzzle(levels[4]),
    back = p.s.tiles.find((t) => t.hidden)!;
  for (const a of p.level.solution!) {
    if (exposed(p.s, back)) break;
    p.apply(a);
  }
  p.tap(back.id);
  assert.equal(back.hidden, false);
  let seed = 1;
  while (((Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296 < 0.85)
    seed++;
  p.s.seed = seed;
  const events = p.gift();
  assert.equal(events[0].positive, false);
  assert.equal(back.hidden, false);
  assert.ok(!events[0].ids?.includes(back.id));
});

test("all 30 base or machine-expanded witnesses complete through actual effects without consumables", () => {
  for (const level of levels) {
    const p = auditedPuzzle(level);
    assert.ok(level.solution?.length);
    let collects = 0;
    for (const action of campaignWitness(level)) {
      const events = checkedApply(p, action);
      assert.ok(
        events.some(
          (e) =>
            e.type === "collect" ||
            e.type === "stash" ||
            e.type === "flip" ||
            (action.type === "wait" && e.type === "boardMove"),
        ),
        `invalid witness ${level.id} ${JSON.stringify(action)}`,
      );
      collects += events.filter((e) => e.type === "collect").length;
      assert.ok(p.s.tray.length <= 4);
    }
    assert.ok(p.won, `witness failed ${level.id}`);
    assert.ok(collects >= level.tiles.length, `round too short ${level.id}`);
    assert.ok(p.s.matches >= 24);
    assert.ok(
      p.s.inventory.shuffle >= 2 &&
        p.s.inventory.magnet >= 2 &&
        p.s.inventory.undo >= 4 &&
        p.s.inventory.hint >= 3,
    );
    assert.equal(p.audit.boardCollections + p.audit.slotReturns, collects);
  }
});

test("dynamic witnesses keep movement, legal queue fronts and versioned restore consistent after every action", () => {
  assert.deepEqual(
    levels.filter((l) => l.movement).map((l) => l.id),
    [16, 18, 20, 21, 23, 24, 25, 27, 28, 30],
  );
  for (const level of levels.filter((l) => l.movement)) {
    const p = new Puzzle(level),
      restored = new Puzzle(level);
    for (const action of level.solution!) {
      const before = p.s.matches,
        events = p.apply(action),
        moves = events.filter((e) => e.type === "boardMove");
      if (p.s.movement!.type !== "conveyor")
        assert.equal(
          moves.length,
          p.s.movement!.type === "belt"
            ? Number(action.type === "wait")
            : p.s.matches - before,
          `one movement per successful pair ${level.id}`,
        );
      if (
        p.s.movement!.type !== "belt" &&
        !(p.s.movement!.type === "ring" && p.s.movement!.reversible)
      )
        assert.equal(p.s.movement!.step, p.s.matches);
      assert.ok(
        restored.restore(p.export()),
        `restore phase ${level.id}:${p.s.matches}`,
      );
      assert.deepEqual(restored.s, p.s);
      if (p.s.movement!.type === "conveyor") {
        const m = p.s.movement!;
        for (let c = 0; c < m.columns.length; c++) {
          const remaining = m.columns[c].filter((id) =>
            onBoard(p.s, p.s.tiles[id]),
          );
          assert.equal(m.frontIds[c], remaining[0] ?? null);
          remaining.forEach((id, depth) =>
            assert.equal(p.s.tiles[id].y, depth),
          );
          for (const id of m.columns[c]) {
            const t = p.s.tiles[id];
            if (onBoard(p.s, t))
              assert.equal(free(p.s, t), id === m.frontIds[c]);
          }
        }
      }
    }
    assert.ok(p.won);
  }
});

test("both periodic belt boards remain solvable from every initial timer phase with actual effects", () => {
  for (const level of levels.filter((l) => l.movement?.type === "belt")) {
    if (level.movement!.type !== "belt") throw Error();
    for (let phase = 0; phase < level.movement!.laneLength; phase++) {
      const p = auditedPuzzle(level);
      for (let i = 0; i < phase; i++) p.advanceBelt();
      const plan = solve(p.s, 250000, 1500);
      assert.ok(plan, `belt ${level.id} phase ${phase}`);
      for (const a of plan) checkedApply(p, a);
      assert.ok(p.won, `belt replay ${level.id} phase ${phase}`);
    }
  }
});

test("replanning after actual special effects yields a complete legal V3 path with no side bypasses", () => {
  for (const level of levels) {
    const p = auditedPuzzle(level);
    let plan: Action[] | null = solve(p.s, 250000, 1500);
    assert.ok(plan, `initial search ${level.id}`);
    for (let step = 0; step < 400 && !p.won; step++) {
      const a = plan.shift();
      assert.ok(a, `empty plan ${level.id}`);
      const events = checkedApply(p, a);
      if (events.some((e) => e.type === "gift" || e.type === "bomb")) {
        plan = solve(p.s, 250000, 1500);
        assert.ok(plan, `replan ${level.id}`);
      }
    }
    assert.ok(p.won, `actual oracle ${level.id}`);
  }
});

test("matching-first exploration benchmark measures capacity decisions rather than random tapping", () => {
  const report = levels.map((level) => {
    let wins = 0,
      exploration = 0,
      rescues = 0;
    for (let i = 0; i < runs; i++) {
      const r = policy(level, Math.imul(20001 + i, 2654435761) >>> 0);
      wins += Number(r.won);
      exploration += r.exploration;
      rescues += Number(r.rescued);
    }
    return {
      id: level.id,
      tiles: level.tiles.length,
      difficulty: level.difficulty,
      wins,
      runs,
      exploration,
      rescues,
    };
  });
  const rate = (d: number) => {
    const group = report.filter((r) => r.difficulty === d);
    return group.reduce((sum, r) => sum + r.wins, 0) / (group.length * runs);
  };
  assert.ok(rate(1) >= 0.65, `easy ${rate(1)}`);
  assert.ok(rate(3) <= 0.85, `hard ${rate(3)}`);
  assert.ok(rate(1) - rate(3) >= 0.1, `no difficulty separation`);
  assert.ok(report.filter((r) => r.exploration > 0).length >= 20);
  assert.ok(
    report.filter((r) => r.difficulty === 3 && r.wins < runs).length >= 6,
  );
  assert.ok(
    report.filter((r) => r.rescues > 0).length >= 5,
    "extra stash must provide real recovery",
  );
  console.log(
    "V3 strict-side matching-first independent benchmark:",
    JSON.stringify({ easy: rate(1), medium: rate(2), hard: rate(3), report }),
  );
});

test("experimental boards have three real manual-triggered deliveries and remain save/restore safe", () => {
  assert.deepEqual(
    levels.filter((l) => l.experiment).map((l) => l.id),
    [17, 19, 26, 29],
  );
  for (const level of levels.filter((l) => l.experiment)) {
    const p = new Puzzle(level),
      restored = new Puzzle(level);
    let triggers = 0;
    for (const action of campaignWitness(level)) {
      const events = p.apply(action);
      triggers += events.filter((e) => e.type === "experiment").length;
      assert.ok(restored.restore(p.export()), `experiment restore ${level.id}`);
      assert.deepEqual(restored.s, p.s);
      assert.ok(p.s.experiment!.streak < level.experiment!.threshold);
      assert.ok(!events.some((e) => e.type === "shuffle"));
    }
    assert.equal(triggers, 3, `repeat deliveries ${level.id}`);
    assert.ok(p.won);
  }
});

test("runtime hints cover every initial and midpoint certified state using the default bounded budget", () => {
  const timings: number[] = [];
  for (const level of levels) {
    const p = new Puzzle(level);
    const witness = campaignWitness(level);
    for (const index of [0, Math.floor(witness.length / 2)]) {
      if (index)
        for (const action of witness.slice(0, index)) p.apply(action);
      const before = p.s.inventory.hint,
        start = performance.now(),
        events = p.use("hint"),
        elapsed = performance.now() - start;
      timings.push(elapsed);
      assert.ok(
        events.some((e) => e.type === "hint"),
        `default runtime hint ${level.id}:${index}: ${JSON.stringify(events)}`,
      );
      assert.equal(p.s.inventory.hint, before - 1);
      assert.ok(
        elapsed < 150,
        `runtime hint budget ${level.id}:${index} took ${elapsed}ms`,
      );
    }
  }
  console.log(
    "Runtime initial/midpoint hint maximum ms:",
    Math.max(...timings),
  );
});

test("bomb tutorial has a real legal explosion and most later bombs hit board pairs", () => {
  let total = 0,
    useful = 0;
  for (const level of levels.filter((l) => l.id >= 7)) {
    const p = new Puzzle(level);
    for (const action of level.solution!)
      for (const event of p.apply(action))
        if (event.type === "bomb") {
          total++;
          useful += Number(!!event.ids?.length);
          if (level.id === 7)
            assert.ok(
              (event.ids?.length || 0) >= 2,
              "tutorial explosion must collect a real pair",
            );
        }
  }
  assert.ok(useful / total >= 0.75, `useful bombs ${useful}/${total}`);
});

test("independent line experiment has a certified legal clear-all witness and useful hints through the whole route", async () => {
  const { makeLineLevel } = await import("../src/core/levels");
  const level = makeLineLevel(),
    p = new Puzzle(level),
    restored = new Puzzle(level);
  assert.equal(makeLevels().length, 30);
  let clears = 0;
  const orientations: string[] = [];
  for (const action of level.solution!) {
    if (p.s.inventory.hint === 0) p.s.inventory.hint = 1;
    const hint = p.use("hint").find((e) => e.type === "hint");
    assert.ok(hint, `line hint before ${action.a}`);
    const t = p.s.tiles.find((t) => t.id === action.a)!;
    assert.ok(
      free(p.s, t) || p.s.slot === t.id,
      `line witness front ${action.a}`,
    );
    const events = p.apply(action);
    clears += events.filter((e) => e.type === "lineClear").length;
    orientations.push(
      ...events
        .filter((e) => e.type === "lineClear")
        .map((e) => e.orientation!),
    );
    assert.ok(!events.some((e) => e.type === "blocked"));
    assert.ok(p.s.tray.length <= 4);
    assert.ok(restored.restore(p.export()));
    assert.deepEqual(restored.s, p.s);
  }
  assert.equal(clears, 2);
  assert.deepEqual(orientations, ["row", "column"]);
  assert.ok(p.won);
  assert.ok(!p.goalFailed);
  assert.equal(p.s.tiles.length, 48);
  assert.ok(p.s.tiles.every((t) => t.removed));
});
