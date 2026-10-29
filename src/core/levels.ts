import {
  type Level,
  type Tile,
  type Kind,
  type State,
  type Movement,
  clone,
  exposed,
  shuffled,
} from "./model";
import authored from "./level-data.json";
import dynamic from "./dynamic-level-data.json";
import lineData from "./line-level-data.json";
export interface Layout {
  id: string | number;
  positions: { x: number; y: number; z: number }[];
  source?: string;
}
export const tile = (
  id: number,
  x: number,
  y: number,
  z: number,
  face: number,
  kind: Kind = "normal",
): Tile => ({
  id,
  x,
  y,
  z,
  face,
  kind,
  removed: false,
  hidden: false,
  everHidden: false,
});
export function initial(tiles: Tile[], seed = 1, movement?: Movement): State {
  return {
    tiles: clone(tiles),
    ...(movement ? { movement: clone(movement) } : {}),
    seed,
    tray: [],
    slot: null,
    slotOpen: false,
    stashCharges: 0,
    slotPending: null,
    inventory: { shuffle: 2, magnet: 2, hint: 3, undo: 4 },
    moves: 0,
    matches: 0,
    combo: 0,
    bestCombo: 0,
    score: 0,
  };
}
const curve = [
  1, 1, 1, 1, 2, 1, 1, 2, 2, 3, 1, 2, 1, 2, 3, 1, 2, 3, 1, 3, 1, 2, 3, 2, 3, 1,
  2, 3, 2, 3,
] as const;
export function seedBacks(level: Level, storedIds?: number[]): void {
  if (level.id < 5) return;
  const state = initial(level.tiles, level.seed, level.movement),
    explicit = new Set(level.solution?.map((a) => a.a));
  const buried = level.tiles.filter(
    (t) => t.kind === "normal" && !exposed(state, t) && explicit.has(t.id),
  );
  const count =
    level.id === 5 ? 4 : Math.min(12, Math.round(level.tiles.length * 0.12));
  const ids =
    storedIds ??
    shuffled(buried, { seed: (level.seed ^ 0x51b1e) >>> 0 })
      .slice(0, count)
      .map((t) => t.id);
  for (const id of ids) {
    const t = level.tiles.find((t) => t.id === id)!;
    t.hidden = true;
    t.everHidden = true;
  }
}
/** V3: four-slot collection AND strict uncovered/side-open board gate.
 * Newly authored layouts, never claimed as recovered APK data. */
export function experimentFor(id: number): Level["experiment"] {
  if (id === 17 || id === 26)
    return {
      type: "dragon",
      threshold: 2,
      maxActivations: 3,
      position: id === 17 ? "top" : "bottom",
    };
  if (id === 19 || id === 29)
    return { type: "slots", threshold: 3, maxActivations: 3, position: "side" };
  return undefined;
}
export function specialPairCounts(id: number) {
  return {
    move: id < 2 ? 0 : id < 4 ? 1 : id < 16 ? 2 : 3,
    bomb: id < 7 ? 0 : id === 7 ? 1 : id < 21 ? 2 : 3,
    gift: id < 13 ? 0 : 1,
  };
}
export function makeLevels(_unverifiedOriginal: Layout[] = []): Level[] {
  return authored.map((data) => {
    const moving = (
      dynamic as unknown as {
        id: number;
        pattern: string;
        intent: string;
        tiles: (number | string)[][];
        movement: Movement;
        solution: Level["solution"];
        blueIds: number[];
      }[]
    ).find((row) => row.id === data.id);
    if (moving) {
      const level: Level = {
        id: data.id,
        experiment: experimentFor(data.id),
        name: moving.pattern,
        subtitle: moving.intent,
        difficulty: curve[data.id - 1],
        seed: 62011 + data.id * 7919,
        source: `新编排 V4 · ${moving.pattern} · 参考视频结构观察，非原 APK 布局`,
        movement: clone(moving.movement),
        tiles: moving.tiles.map(([x, y, z, face, kind], id) =>
          tile(id, Number(x), Number(y), Number(z), Number(face), kind as Kind),
        ),
        solution: clone(moving.solution),
        ...(data.id === 16
          ? { lesson: "ring" }
          : data.id === 21
            ? { lesson: "conveyor" }
            : {}),
      };
      seedBacks(level, moving.blueIds);
      return level;
    }
    const level: Level = {
      id: data.id,
      experiment: experimentFor(data.id),
      name:
        data.id === 17
          ? "龙息庭院"
          : data.id === 26
            ? "卧龙回礼"
            : data.id === 19
              ? "三连惊喜"
              : data.id === 29
                ? "幸运边台"
                : data.pattern,
      subtitle:
        data.id === 17 || data.id === 26
          ? "手动连续配对两次，龙送来牌对、道具或龙息；每关三次"
          : data.id === 19 || data.id === 29
            ? "手动连续配对三次，边台自动开奖；每关三次"
            : data.intent,
      difficulty: curve[data.id - 1],
      seed: 62011 + data.id * 7919,
      source: `新编排 V3 · ${data.pattern} · 参考视频结构观察，非原 APK 布局`,
      ...(data.id === 1
        ? { lesson: "pair" }
        : data.id === 2
          ? { lesson: "move" }
          : data.id === 7
            ? { lesson: "bomb" }
            : data.id === 13
              ? { lesson: "gift" }
              : {}),
      tiles: data.tiles.map(([x, y, z, face, kind], id) =>
        tile(id, Number(x), Number(y), Number(z), Number(face), kind as Kind),
      ),
      solution: clone(data.solution) as Level["solution"],
    };
    // Fixed IDs preserve initial backs when the certified action path changes.
    seedBacks(level, (data as { blueIds?: number[] }).blueIds);
    return level;
  });
}

/** Independent experiment; the thirty-level campaign remains unchanged. */
export function makeLineLevel(): Level {
  const columns = lineData.faces.map((faces, c) =>
    faces.map((_, d) => c * faces.length + d),
  );
  return {
    id: 31,
    name: "六列消线",
    subtitle: "取走最下方的牌，凑齐六张同面整行或整列；消线两次并清空全部牌",
    difficulty: 2,
    seed: lineData.seed,
    source: "独立实验关 · 6×6 下落棋盘 · 48 张有限队列",
    lesson: "lines",
    lineGuide: [32, 1],
    movement: {
      type: "lines",
      columns,
      frontIds: columns.map((c) => c[0]),
      rows: 6,
      target: 2,
      cleared: 0,
      step: 0,
    },
    tiles: columns.flatMap((ids, c) =>
      ids.map((id, d) => tile(id, c * 1.2, 5 - d, 0, lineData.faces[c][d])),
    ),
    solution: clone(lineData.solution) as Level["solution"],
  };
}
