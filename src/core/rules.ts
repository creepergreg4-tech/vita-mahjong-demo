import {
  type State,
  type Tile,
  type Tool,
  type Level,
  type Event,
  type Action,
  clone,
  random,
  shuffled,
  same,
  live,
  onBoard,
  exposed,
  free,
  pairs,
  canStash,
  blockers,
  TRAY_CAPACITY,
  moveBoard,
  settleBoard,
  clearedBoard,
  objectiveMet,
  isQueued,
  relocateBonus,
} from "./model";
import { solve, registerTransition, registerWitness } from "./solver";

const witnessHints = new Map<
  string,
  {
    states: Map<string, { path: Action[]; index: number }>;
    replay: Puzzle;
    path: Action[];
    cursor: number;
  }
>();
/** Inventory does not change a no-consumable witness; all board/PRNG/mechanic state does. */
function hintStateKey(s: State): string {
  return JSON.stringify([
    s.levelId,
    s.tiles,
    s.tray,
    s.slot,
    s.slotOpen,
    s.slotPending,
    s.stashCharges || 0,
    s.seed,
    s.movement,
    s.experiment,
    s.bonus,
    s.matches,
    s.combo,
    s.bestCombo,
    s.unbelievableCount || 0,
    s.unbelievableMilestones || [],
  ]);
}
export class Puzzle {
  s: State;
  /** Kept for UI compatibility; board taps now collect immediately. */
  selected: number | null = null;
  history: State[] = [];
  stashMode = false;
  /** Search/replay still executes all rules, omitting unused animation snapshots. */
  simulation = false;
  private automaticDepth = 0;
  private costs: { undo: number; hint: number }[] = [];
  private spent = { undo: 0, hint: 0 };
  constructor(public level: Level) {
    this.s = {
      levelId: level.id,
      ...(level.experiment
        ? {
            experiment: {
              ...clone(level.experiment),
              streak: 0,
              activations: 0,
            },
            bonusIQ: 0,
          }
        : {}),
      unbelievableCount: 0,
      unbelievableMilestones: [],
      ...(level.movement
        ? { movement: clone(level.movement), levelId: level.id }
        : {}),
      tiles: clone(level.tiles),
      tray: [],
      slot: null,
      slotOpen: false,
      stashCharges: 0,
      slotPending: null,
      inventory: { shuffle: 2, magnet: 2, hint: 3, undo: 4 },
      seed: level.seed,
      moves: 0,
      matches: 0,
      combo: 0,
      bestCombo: 0,
      score: 0,
    };
    if (level.movement && level.solution)
      registerWitness(this.s, level.solution);
  }
  export() {
    return {
      rulesVersion: 5,
      signature: this.signature(),
      level: this.level.id,
      state: clone(this.s),
      history: clone(this.history),
      costs: clone(this.costs),
      spent: { ...this.spent },
    };
  }
  private signature() {
    return JSON.stringify([
      this.level.tiles.map((t) => [t.id, t.x, t.y, t.z, t.face, t.kind]),
      this.level.movement || null,
      this.level.experiment || null,
    ]);
  }
  restore(data: any) {
    if (data?.rulesVersion === 4 && this.level.movement?.type === "conveyor") {
      // V4 allowed a single vacant front while its card was held. Validate that
      // legacy geometry first, then compact without awarding a match or score.
      // State/history are cloned so an unsuccessful restore never edits storage.
      data = clone(data);
      const migrate = (s: State): boolean => {
        const m = s?.movement;
        if (
          m?.type !== "conveyor" ||
          !Array.isArray(s.tiles) ||
          !Array.isArray(s.tray) ||
          !Array.isArray(m.columns) ||
          !Array.isArray(m.frontIds) ||
          JSON.stringify(m.columns) !==
            JSON.stringify(
              this.level.movement!.type === "conveyor"
                ? this.level.movement!.columns
                : [],
            )
        )
          return false;
        for (const [c, ids] of m.columns.entries()) {
          const front = m.frontIds[c],
            frontTile = s.tiles.find((t) => t.id === front);
          if (front !== null && !ids.includes(front)) return false;
          let depth = frontTile && onBoard(s, frontTile) ? 0 : 1;
          for (const id of ids) {
            const t = s.tiles.find((t) => t.id === id);
            if (!t) return false;
            if (!onBoard(s, t)) continue;
            if (
              front === null ||
              ids.indexOf(id) < ids.indexOf(front) ||
              t.x !== c * 1.2 ||
              t.y !== depth++ ||
              t.z !== 0
            )
              return false;
          }
        }
        moveBoard(s, false, false, false, false);
        return true;
      };
      if (!migrate(data.state)) return false;
      if (
        !Array.isArray(data.history) ||
        !data.history.every((s: State) => migrate(s))
      ) {
        data.history = [];
        data.costs = [];
      }
      data.rulesVersion = 5;
    }
    if (
      !(
        data?.rulesVersion === 5 ||
        (data?.rulesVersion === 4 &&
          this.level.movement?.type !== "conveyor" &&
          this.level.movement?.type !== "lines") ||
        (data?.rulesVersion === 3 && !this.level.movement)
      ) ||
      (data.rulesVersion >= 4 && data.signature !== this.signature()) ||
      data.level !== this.level.id ||
      !Array.isArray(data.state?.tiles) ||
      data.state.tiles.length !==
        this.level.tiles.length + (data.state.bonus ? 2 : 0) ||
      !Array.isArray(data.state.tray) ||
      data.state.tray.length > TRAY_CAPACITY
    )
      return false;
    const valid = (s: State) => {
      if (
        !s ||
        !Array.isArray(s.tiles) ||
        s.tiles.length !== this.level.tiles.length + (s.bonus ? 2 : 0) ||
        !Array.isArray(s.tray) ||
        new Set(s.tray).size !== s.tray.length ||
        s.tray.length > TRAY_CAPACITY
      )
        return false;
      if (
        !Number.isInteger(s.stashCharges || 0) ||
        (s.stashCharges || 0) < 0 ||
        (s.stashCharges || 0) > 3
      )
        return false;
      if (this.level.experiment) {
        const e = s.experiment,
          expected = this.level.experiment;
        if (
          !e ||
          e.type !== expected.type ||
          e.threshold !== expected.threshold ||
          e.maxActivations !== expected.maxActivations ||
          e.position !== expected.position ||
          !Number.isInteger(e.streak) ||
          e.streak < 0 ||
          e.streak >= e.threshold ||
          !Number.isInteger(e.activations) ||
          e.activations < 0 ||
          e.activations > e.maxActivations ||
          !Number.isInteger(s.bonusIQ) ||
          s.bonusIQ! < 0 ||
          s.bonusIQ! > 60
        )
          return false;
      } else if (s.experiment) return false;
      if (s.bonus) {
        const ids = [
          Math.max(...this.level.tiles.map((t) => t.id)) + 1,
          Math.max(...this.level.tiles.map((t) => t.id)) + 2,
        ];
        if (
          this.level.id < 22 ||
          this.level.movement?.type === "lines" ||
          JSON.stringify(s.bonus.ids) !== JSON.stringify(ids) ||
          !["active", "claimed", "expired"].includes(s.bonus.status) ||
          !Number.isFinite(s.bonus.remainingMs) ||
          s.bonus.remainingMs < 0 ||
          s.bonus.remainingMs > 12000
        )
          return false;
        for (let i = 0; i < 2; i++) {
          const t = s.tiles[this.level.tiles.length + i];
          if (
            !t ||
            t.id !== ids[i] ||
            !t.bonus ||
            t.kind !== "gift" ||
            t.hidden ||
            ![t.x, t.y, t.z].every(Number.isFinite) ||
            (s.bonus.status !== "active" ? !t.removed : t.removed)
          )
            return false;
        }
      }
      if (this.level.movement) {
        const m = s.movement,
          expected = clone(this.level.movement);
        if (
          !m ||
          s.levelId !== this.level.id ||
          !Number.isInteger(m.step) ||
          (!(m.type === "ring" && m.reversible) && m.step < 0) ||
          (m.type !== "belt" &&
            m.type !== "lines" &&
            !(m.type === "ring" && m.reversible) &&
            m.step !== s.matches)
        )
          return false;
        expected.step = m.step;
        if (
          (expected.type === "conveyor" && m.type === "conveyor") ||
          (expected.type === "lines" && m.type === "lines")
        ) {
          if (
            JSON.stringify(m.columns) !== JSON.stringify(expected.columns) ||
            !Array.isArray(m.frontIds) ||
            m.frontIds.length !== m.columns.length ||
            m.frontIds.some(
              (id, i) => id !== null && !m.columns[i].includes(id),
            )
          )
            return false;
          expected.frontIds = clone(m.frontIds);
          if (expected.type === "lines" && m.type === "lines") {
            if (
              !Number.isInteger(m.cleared) ||
              m.cleared < 0 ||
              m.cleared * 6 > s.tiles.filter((t) => t.removed).length ||
              m.step !== s.matches + m.cleared
            )
              return false;
            expected.cleared = m.cleared;
          }
        }
        if (JSON.stringify(m) !== JSON.stringify(expected)) return false;
      } else if (s.movement) return false;
      for (let i = 0; i < this.level.tiles.length; i++) {
        const t = s.tiles[i],
          e = this.level.tiles[i];
        if (
          !t ||
          t.id !== e.id ||
          !!t.bonus ||
          ![t.x, t.y, t.z].every(Number.isFinite) ||
          ((!this.level.movement ||
            (this.level.movement.type !== "conveyor" &&
              this.level.movement.type !== "lines" &&
              !this.level.movement.tileIds.includes(t.id))) &&
            (t.x !== e.x || t.y !== e.y || t.z !== e.z))
        )
          return false;
      }
      const held = [...s.tray, ...(s.slot === null ? [] : [s.slot])];
      if (
        new Set(held).size !== held.length ||
        held.some((id) => !s.tiles.some((t) => t.id === id && !t.removed))
      )
        return false;
      if (this.level.movement) {
        const expected = clone(s);
        moveBoard(expected);
        if (
          JSON.stringify(s.movement) !== JSON.stringify(expected.movement) ||
          s.tiles.some(
            (t, i) =>
              onBoard(s, t) &&
              (t.x !== expected.tiles[i].x ||
                t.y !== expected.tiles[i].y ||
                t.z !== expected.tiles[i].z),
          )
        )
          return false;
      }

      return (
        s.slotPending === null ||
        s.tiles.some(
          (t) => t.id === s.slotPending && !t.removed && t.kind === "normal",
        )
      );
    };
    if (!valid(data.state)) return false;
    this.s = clone(data.state);
    this.history = clone(data.history || []);
    this.costs = clone(data.costs || []);
    this.spent = { undo: data.spent?.undo || 0, hint: data.spent?.hint || 0 };
    if (
      this.costs.length !== this.history.length ||
      this.history.some((s) => !valid(s))
    ) {
      this.history = [];
      this.costs = [];
    }
    this.selected = null;
    this.stashMode = false;
    return true;
  }
  get won() {
    return objectiveMet(this.s);
  }
  get goalFailed() {
    return clearedBoard(this.s) && !objectiveMet(this.s);
  }
  /** Timer ticks are explicit: the scene calls this only after six active idle seconds. */
  advanceBelt(): Event[] {
    if (this.s.movement?.type !== "belt" || this.won) return [];
    return moveBoard(this.s, false, true, false, !this.simulation);
  }
  private boardSnapshot() {
    return {
      tiles: clone(this.s.tiles),
      tray: [...this.s.tray],
      slot: this.s.slot,
      movement: this.s.movement ? clone(this.s.movement) : undefined,
    };
  }
  startBonus(): Event[] {
    if (
      this.level.id < 22 ||
      this.s.movement?.type === "lines" ||
      this.won ||
      this.s.bonus ||
      (this.s.unbelievableCount || 0) < 2
    )
      return [];
    const boardBefore = this.boardSnapshot(),
      id = Math.max(...this.s.tiles.map((t) => t.id)) + 1,
      ids: [number, number] = [id, id + 1];
    this.s.bonus = { ids, remainingMs: 12000, status: "active" };
    this.s.tiles.push(
      ...ids.map(
        (id, i): Tile => ({
          id,
          x: i === 0 ? 0 : 5,
          y: -1.2,
          z: 0,
          kind: "gift",
          face: 0,
          removed: false,
          hidden: false,
          everHidden: false,
          bonus: true,
        }),
      ),
    );
    relocateBonus(this.s, true);
    return [
      {
        type: "bonusSpawn",
        ids,
        text: "狂热时刻 · 12 秒限时礼盒",
        boardBefore,
        boardAfter: this.boardSnapshot(),
      },
    ];
  }
  tickBonus(deltaMs: number): Event[] {
    const bonus = this.s.bonus;
    if (
      !bonus ||
      bonus.status !== "active" ||
      !Number.isFinite(deltaMs) ||
      deltaMs <= 0
    )
      return [];
    bonus.remainingMs = Math.max(0, bonus.remainingMs - deltaMs);
    if (bonus.remainingMs > 0) return [];
    const boardBefore = this.boardSnapshot(),
      before = [...this.s.tray];
    bonus.status = "expired";
    this.s.tiles
      .filter((t) => t.bonus)
      .forEach((t) => {
        t.removed = true;
      });
    this.s.tray = this.s.tray.filter((id) => !bonus.ids.includes(id));
    return [
      {
        type: "bonusExpire",
        ids: [...bonus.ids],
        trayBefore: before,
        trayAfter: [...this.s.tray],
        boardBefore,
        boardAfter: this.boardSnapshot(),
        text: "限时礼盒已离场",
      },
    ];
  }
  private settleBonus() {
    if (
      this.s.bonus?.status !== "active" ||
      !this.s.bonus.ids.every(
        (id) => this.s.tiles.find((t) => t.id === id)?.removed,
      )
    )
      return;
    this.s.bonus.status = "claimed";
    this.s.bonus.remainingMs = 0;
    // A random timed reward is a settlement boundary, never an undo/reroll loop.
    this.history = [];
    this.costs = [];
  }
  private keepElapsedBonus(current: State) {
    this.s.unbelievableCount = Math.max(
      this.s.unbelievableCount || 0,
      current.unbelievableCount || 0,
    );
    this.s.unbelievableMilestones = [
      ...new Set([
        ...(this.s.unbelievableMilestones || []),
        ...(current.unbelievableMilestones || []),
      ]),
    ];
    const bonus = current.bonus;
    if (!bonus) return;
    const old = this.s.bonus;
    this.s.bonus = clone(bonus);
    if (!old) {
      for (const t of current.tiles.filter((t) => t.bonus))
        this.s.tiles.push({ ...clone(t), removed: false });
    }
    if (bonus.status !== "active") {
      this.s.tiles
        .filter((t) => t.bonus)
        .forEach((t) => {
          t.removed = true;
        });
      this.s.tray = this.s.tray.filter((id) => !bonus.ids.includes(id));
    }
  }
  get full() {
    return this.s.tray.length >= TRAY_CAPACITY;
  }
  get availablePairs() {
    return pairs(this.s);
  }
  get stalled() {
    if (this.won) return false;
    // Full is provisional recovery state, never destructive loss.
    if (this.full) return true;
    return !this.s.tiles.some((t) => free(this.s, t)) && this.s.slot === null;
  }
  save() {
    this.history.push(clone(this.s));
    this.costs.push({ ...this.spent });
    if (this.history.length > 200) {
      this.history.shift();
      this.costs.shift();
    }
  }
  remove(a: Tile, b: Tile) {
    a.removed = b.removed = true;
    this.s.tray = this.s.tray.filter((id) => id !== a.id && id !== b.id);
    if (this.s.slot === a.id || this.s.slot === b.id) this.s.slot = null;
    if (this.s.slotPending === a.id || this.s.slotPending === b.id) {
      this.s.slotPending = null;
      this.s.slotOpen = false;
    }
    this.s.matches++;
    this.s.combo++;
    this.s.bestCombo = Math.max(this.s.bestCombo, this.s.combo);
    if (this.s.combo >= 25 && this.s.combo % 5 === 0) {
      const milestones = (this.s.unbelievableMilestones ??= []);
      if (!milestones.includes(this.s.matches)) {
        milestones.push(this.s.matches);
        this.s.unbelievableCount = (this.s.unbelievableCount || 0) + 1;
      }
    }
    this.s.score += 100 + Math.min(10, this.s.combo) * 10;
  }
  private effects(kind: Tile["kind"]): Event[] {
    if (kind === "move") {
      if (this.s.slotPending === null && !this.s.slotOpen) {
        this.s.slotOpen = true;
        return [
          { type: "unlock", text: "暂存已解锁 · 可移入一张表面牌或槽内牌" },
        ];
      }
      const before = this.s.stashCharges || 0;
      this.s.stashCharges = Math.min(3, before + 1);
      return [
        {
          type: "unlock",
          stashCharges: this.s.stashCharges,
          amount: this.s.stashCharges - before,
          text:
            before < 3
              ? "暂存机会 +1 · 当前牌配对后可再次启用"
              : "已储存 3 次暂存机会",
        },
      ];
    }
    if (kind === "bomb") return this.blast();
    if (kind === "gift") return this.gift();
    return [];
  }
  private collect(t: Tile): Event[] {
    if (t.removed) return [];
    // Final invariant: callers cannot accidentally skip the ordinary board gate.
    if (onBoard(this.s, t) && !free(this.s, t))
      return [
        {
          type: "blocked",
          ids: blockers(this.s, t),
          text: exposed(this.s, t)
            ? "左右都被夹住了，先移开一侧的牌"
            : "先移开上面的牌",
        },
      ];
    if (this.full) return [{ type: "notice", text: "四格已满" }];
    const before = [...this.s.tray],
      source = this.s.slot === t.id ? "slot" : "board";
    if (source === "slot") this.s.slot = null;
    const partnerIndex = this.s.tray.findIndex((id) =>
      same(this.s.tiles.find((x) => x.id === id)!, t),
    );
    const index = partnerIndex < 0 ? this.s.tray.length : partnerIndex + 1;
    // A new unrelated face interrupts the chain; planning/reveals never do.
    if (partnerIndex < 0 && before.length > 0) {
      this.s.combo = 0;
      if (!this.automaticDepth && this.s.experiment)
        this.s.experiment.streak = 0;
    }
    this.s.tray.splice(index, 0, t.id);
    const inserted = [...this.s.tray];
    const ev: Event[] = [
      {
        type: "collect",
        ids: [t.id],
        source,
        index,
        trayBefore: before,
        trayAfter: inserted,
      },
    ];
    if (partnerIndex >= 0) {
      const a = this.s.tiles.find((x) => x.id === before[partnerIndex])!;
      this.remove(a, t);
      ev.push({
        type: "match",
        combo: this.s.combo,
        bestCombo: this.s.bestCombo,
        ids: [a.id, t.id],
        trayBefore: inserted,
        trayAfter: [...this.s.tray],
      });
      ev.push(
        ...settleBoard(this.s, true, t.kind !== "normal", !this.simulation),
      );
      ev.push(...this.effects(t.kind));
      if (t.bonus) this.settleBonus();
      else if (!this.automaticDepth) ev.push(...this.chargeExperiment());
    } else if (source === "board") {
      ev.push(...settleBoard(this.s, false, false, !this.simulation));
    }
    return ev;
  }
  tap(id: number): Event[] {
    const t = this.s.tiles.find((x) => x.id === id);
    if (!t || t.removed) return [];
    if (this.stashMode) {
      if (!canStash(this.s, t))
        return [{ type: "notice", text: "选一张无遮挡的普通牌或槽内普通牌" }];
      this.save();
      const before = [...this.s.tray],
        source = before.includes(id) ? "tray" : "board";
      this.s.tray = this.s.tray.filter((x) => x !== id);
      this.s.slot = id;
      this.s.slotPending = id;
      this.s.moves++;
      this.stashMode = false;
      this.selected = null;
      return [
        {
          type: "stash",
          ids: [id],
          source,
          trayBefore: before,
          trayAfter: [...this.s.tray],
          text: "这张牌消除后，暂存格重新锁定",
        },
        ...(source === "board"
          ? settleBoard(this.s, false, false, !this.simulation)
          : []),
      ];
    }
    // A tray card stays held; tapping it is not a second board selection.
    if (this.s.tray.includes(id)) return [];
    if (!exposed(this.s, t))
      return [
        {
          type: "blocked",
          ids: blockers(this.s, t),
          text: isQueued(this.s, t)
            ? this.s.movement?.type === "lines"
              ? "只可收取每列最下方的牌，取牌后自动下落"
              : "只可收取每列最上方的牌，取牌后立即补位"
            : "先移开上面的牌",
        },
      ];
    if (t.hidden) {
      this.save();
      t.hidden = false;
      this.s.moves++;
      return [{ type: "flip", ids: [id] }];
    }
    if (this.full)
      return [
        { type: "notice", text: "四格已满 · 可回退、洗牌、用磁铁或暂存" },
      ];
    if (onBoard(this.s, t) && !free(this.s, t))
      return [
        {
          type: "blocked",
          ids: blockers(this.s, t),
          text: "左右都被夹住了，先移开一侧的牌",
        },
      ];
    this.save();
    this.s.moves++;
    this.selected = null;
    return this.collect(t);
  }
  toggleStash(): Event[] {
    if (
      !this.s.slotOpen &&
      this.s.slot === null &&
      this.s.slotPending === null &&
      (this.s.stashCharges || 0) > 0
    ) {
      this.save();
      this.s.stashCharges!--;
      this.s.slotOpen = true;
      this.s.moves++;
      this.stashMode = true;
      return [
        {
          type: "unlock",
          stashCharges: this.s.stashCharges,
          amount: -1,
          text: "已启用储存的暂存机会 · 选一张表面普通牌",
        },
      ];
    }
    if (!this.s.slotOpen)
      return [{ type: "notice", text: "消除一对移位牌，解锁暂存" }];
    if (this.s.slot !== null) return this.tap(this.s.slot);
    if (this.s.slotPending !== null)
      return [{ type: "notice", text: "暂存牌已回到四格槽，消除后重新锁定" }];
    this.stashMode = !this.stashMode;
    this.selected = null;
    return [
      {
        type: "notice",
        text: this.stashMode ? "选一张表面普通牌或槽内普通牌" : "已取消暂存",
      },
    ];
  }
  private blastTargets(limit = 2): [Tile, Tile][] {
    // Automatic board pairs follow the same collect path. Two spare places avoid
    // exceeding capacity, and held faces are excluded to keep these exact pairs.
    if (this.s.tray.length > TRAY_CAPACITY - 2) return [];
    const held = this.s.tray.map(
      (id) => this.s.tiles.find((t) => t.id === id)!,
    );
    const ts = this.s.tiles.filter(
      (t) =>
        t.kind === "normal" &&
        !t.hidden &&
        free(this.s, t) &&
        !held.some((h) => same(h, t)),
    );
    const used = new Set<number>(),
      result: [Tile, Tile][] = [];
    for (let i = 0; i < ts.length; i++)
      for (let j = i + 1; j < ts.length; j++) {
        if (used.has(ts[i].id) || used.has(ts[j].id) || !same(ts[i], ts[j]))
          continue;
        result.push([ts[i], ts[j]]);
        used.add(ts[i].id);
        used.add(ts[j].id);
        if (result.length === limit) return result;
      }
    return result;
  }
  blast(limit = 2, actor?: "dragon" | "slots"): Event[] {
    this.automaticDepth++;
    try {
      return this.blastAutomatic(limit, actor);
    } finally {
      this.automaticDepth--;
    }
  }
  private blastAutomatic(limit: number, actor?: "dragon" | "slots"): Event[] {
    if (this.s.movement) {
      const ev: Event[] = [
        { type: "bomb", actor, ids: [], text: "爆破自动收取" },
      ];
      for (let i = 0; i < limit; i++) {
        const pair = this.blastTargets(1)[0];
        if (!pair) break;
        ev[0].ids!.push(...pair.map((t) => t.id));
        ev.push(...this.collect(pair[0]), ...this.collect(pair[1]));
      }
      ev[0].text = ev[0].ids!.length
        ? `爆破自动收取 ${ev[0].ids!.length / 2} 对`
        : "暂时没有合适的爆破目标";
      return ev[0].ids!.length ? ev : this.emptyBlastReward(ev);
    }
    const targets = this.blastTargets(limit),
      ids = targets.flatMap((p) => p.map((t) => t.id));
    const events: Event[] = [
      {
        type: "bomb",
        actor,
        ids,
        text: ids.length
          ? `爆破自动收取 ${targets.length} 对`
          : "暂时没有合适的爆破目标",
      },
    ];
    for (const [a, b] of targets) {
      events.push(...this.collect(a));
      events.push(...this.collect(b));
    }
    return ids.length ? events : this.emptyBlastReward(events);
  }
  private emptyBlastReward(events: Event[]): Event[] {
    if (this.s.tray.length > TRAY_CAPACITY - 2) return events;
    const inventoryBefore = clone(this.s.inventory),
      before = this.s.inventory.hint++;
    events[0].text = "暂无合法爆破目标 · 赠送线索 +1";
    events.push({
      type: "gift",
      positive: true,
      actor: events[0].actor,
      reward: "hint",
      amount: 1,
      text: "爆破补给 · 线索 +1",
      rewardCountBefore: before,
      rewardCountAfter: this.s.inventory.hint,
      inventoryBefore,
      inventoryAfter: clone(this.s.inventory),
    });
    return events;
  }
  /** Only a manual pair can charge the character. Nested bombs cannot recurse. */
  private chargeExperiment(): Event[] {
    const e = this.s.experiment;
    if (!e || e.activations >= e.maxActivations || this.won) return [];
    e.streak++;
    if (e.streak < e.threshold) return [];
    e.streak = 0;
    e.activations++;
    const pair = this.blastTargets(1)[0];
    const pool: NonNullable<Event["result"]>[] =
      e.type === "dragon"
        ? ["hint", "undo", "magnet", "pairMove", "pairBomb", "fire"]
        : ["hint", "undo", "magnet", "shuffle", "pairMove", "pairBomb", "iq"];
    const available = pool.filter(
      (r) =>
        (pair || !["pairMove", "pairBomb", "fire"].includes(r)) &&
        (r !== "pairMove" || (!this.s.slotOpen && this.s.slotPending === null)),
    );
    const result = available[Math.floor(random(this.s) * available.length)];
    const amount = e.type === "slots" && random(this.s) < 0.08 ? 2 : 1;
    const ev: Event[] = [
      {
        type: "experiment",
        actor: e.type,
        result,
        amount,
        activation: e.activations,
        charge: e.streak,
        threshold: e.threshold,
        ids: [],
      },
    ];
    if (result === "pairMove" || result === "pairBomb") {
      const boardBefore = this.boardSnapshot();
      for (const t of pair!) {
        t.kind = result === "pairMove" ? "move" : "bomb";
        t.face = 0;
      }
      Object.assign(ev[0], {
        amount: 1,
        ids: pair!.map((t) => t.id),
        boardBefore,
        boardAfter: this.boardSnapshot(),
        text: result === "pairMove" ? "送来一对移位牌" : "送来一对爆破牌",
      });
    } else if (result === "fire") {
      ev[0].text = "龙息收取一对";
      ev.push(...this.blast(1, e.type));
      ev[0].ids = ev.find((x) => x.type === "bomb")?.ids;
    } else if (result === "iq") {
      const gain = amount * 10;
      this.s.bonusIQ = (this.s.bonusIQ || 0) + gain;
      this.s.score += gain;
      Object.assign(ev[0], { amount: gain, text: `智慧积分 +${gain}` });
    } else {
      const inventoryBefore = clone(this.s.inventory),
        before = this.s.inventory[result];
      this.s.inventory[result] += amount;
      const names = {
        hint: "线索",
        undo: "回退",
        magnet: "磁铁",
        shuffle: "洗牌",
      };
      const text = `${names[result]} +${amount}`;
      ev[0].text = text;
      ev.push({
        type: "gift",
        actor: e.type,
        result,
        reward: result,
        positive: true,
        amount,
        text,
        rewardCountBefore: before,
        rewardCountAfter: this.s.inventory[result],
        inventoryBefore,
        inventoryAfter: clone(this.s.inventory),
      });
    }
    return ev;
  }
  gift(): Event[] {
    const tutorial = this.level.id === 13,
      positive = tutorial || random(this.s) < 0.85;
    if (!positive) {
      const ts = shuffled(
        this.s.tiles.filter(
          (t) =>
            onBoard(this.s, t) &&
            t.kind === "normal" &&
            !t.everHidden &&
            exposed(this.s, t),
        ),
        this.s,
      ).slice(0, 4);
      ts.forEach((t) => {
        t.hidden = true;
        t.everHidden = true;
      });
      this.s.reward = "蒙眼布";
      return [
        {
          type: "gift",
          ids: ts.map((t) => t.id),
          positive: false,
          reward: "veil",
          text: ts.length
            ? "小小迷雾 · 点牌即可永久翻开"
            : "迷雾散去 · 没有牌被遮住",
        },
      ];
    }
    const pool = ["hint", "hint", "undo", "undo", "magnet", "shuffle"];
    if (!this.s.slotOpen && this.s.slotPending === null) pool.push("move");
    if (this.blastTargets(1).length) pool.push("bomb");
    const reward = tutorial
      ? "undo"
      : pool[Math.floor(random(this.s) * pool.length)];
    this.s.reward = reward;
    const names: Record<string, string> = {
      hint: "线索 +1",
      undo: "回退 +1",
      magnet: "磁铁 +1",
      shuffle: "洗牌 +1",
      move: "暂存已解锁",
      bomb: "爆破礼遇",
    };
    const inventoryBefore = clone(this.s.inventory);
    const ev: Event[] = [
      { type: "gift", positive: true, reward, text: names[reward] },
    ];
    if (reward === "move") {
      this.s.slotOpen = true;
      ev.push({ type: "unlock" });
    } else if (reward === "bomb") ev.push(...this.blast());
    else {
      const tool = reward as Tool;
      this.s.inventory[tool]++;
      Object.assign(ev[0], {
        rewardCountBefore: inventoryBefore[tool],
        rewardCountAfter: this.s.inventory[tool],
        inventoryBefore,
        inventoryAfter: clone(this.s.inventory),
      });
    }
    return ev;
  }
  private certifiedHintPath(): Action[] | null {
    if (!this.level.solution?.length) return null;
    const signature = `${this.level.id}:${this.signature()}:${JSON.stringify(this.level.solution)}`;
    let cache = witnessHints.get(signature);
    if (!cache) {
      const replay = new Puzzle(this.level),
        path = this.level.solution;
      replay.save = () => {};
      replay.simulation = true;
      cache = {
        replay,
        path,
        cursor: 0,
        states: new Map([[hintStateKey(replay.s), { path, index: 0 }]]),
      };
      witnessHints.set(signature, cache);
      if (witnessHints.size > 64)
        witnessHints.delete(witnessHints.keys().next().value!);
    }
    const key = hintStateKey(this.s);
    let entry = cache.states.get(key);
    const deadline = performance.now() + 85;
    // The authored witness is certified offline. Replay only as far as requested,
    // rather than spending a whole-board animation/snapshot pass on the first hint.
    while (
      !entry &&
      cache.cursor < cache.path.length &&
      performance.now() < deadline
    ) {
      const { replay: p, path } = cache,
        index = cache.cursor;
      const action = path[index],
        t = p.s.tiles.find((t) => t.id === action.a);
      if (action.type !== "wait" && t?.hidden && exposed(p.s, t)) {
        p.tap(t.id);
        cache.states.set(hintStateKey(p.s), { path, index });
      }
      p.apply(action);
      cache.cursor++;
      cache.states.set(hintStateKey(p.s), { path, index: cache.cursor });
      entry = cache.states.get(key);
    }
    return entry ? entry.path.slice(entry.index) : null;
  }
  use(tool: Tool): Event[] {
    if (this.s.inventory[tool] <= 0)
      return [{ type: "notice", text: "本关次数已用完，可以重试" }];
    this.selected = null;
    this.stashMode = false;
    if (tool === "undo") {
      const previous = this.history.at(-1);
      if (!previous)
        return [
          {
            type: "notice",
            text:
              this.s.bonus?.status === "claimed"
                ? "限时礼盒奖励已结算，后续操作仍可回退"
                : "还没有可以回退的操作",
          },
        ];
      const checkpoint = this.costs.at(-1)!;
      const balance =
        previous.inventory.undo - (this.spent.undo + 1 - checkpoint.undo);
      if (balance < 0)
        return [
          { type: "notice", text: "礼盒刚赠送的回退，不能用来撤回礼盒本身" },
        ];
      const before = [...this.s.tray],
        current = this.s;
      this.history.pop();
      this.costs.pop();
      this.spent.undo++;
      this.s = previous;
      this.keepElapsedBonus(current);
      if (
        current.movement?.type === "belt" &&
        this.s.movement?.type === "belt"
      ) {
        this.s.movement.step = current.movement.step;
        moveBoard(this.s);
      }
      relocateBonus(this.s);
      this.s.inventory.undo = balance;
      this.s.inventory.hint = Math.max(
        0,
        this.s.inventory.hint - (this.spent.hint - checkpoint.hint),
      );
      const location = (s: State, t: Tile): "board" | "tray" | "slot" =>
        s.slot === t.id ? "slot" : s.tray.includes(t.id) ? "tray" : "board";
      const restored = live(this.s)
        .filter((t) => {
          const old = current.tiles.find((o) => o.id === t.id)!;
          return old.removed || location(current, old) !== location(this.s, t);
        })
        .map((t) => ({ id: t.id, source: location(this.s, t) }));
      return [
        {
          type: "undo",
          ids: restored.map((t) => t.id),
          restored,
          trayBefore: before,
          trayAfter: [...this.s.tray],
          text: "已回退上一次操作",
        },
      ];
    }
    if (tool === "hint") {
      const path = this.certifiedHintPath() || solve(this.s);
      if (!path)
        return [{ type: "notice", text: "暂未找到完整解法，试试回退或洗牌" }];
      const a = path[0];
      if (!a) return [];
      if (a.type === "wait") {
        this.s.inventory.hint--;
        this.spent.hint++;
        return [
          {
            type: "hint",
            ids: [],
            text:
              this.s.movement?.type === "belt"
                ? "等待传送带下一拍，再观察打开的入口"
                : "等待限时礼盒离场，释放槽位",
          },
        ];
      }
      const ids = a.type === "pair" ? [a.a, a.b] : [a.a],
        hidden = ids.filter(
          (id) => this.s.tiles.find((t) => t.id === id)?.hidden,
        );
      this.s.inventory.hint--;
      this.spent.hint++;
      return [
        {
          type: "hint",
          ids: hidden.length ? [hidden[0]] : a.type === "pair" ? ids : [a.a],
          text: hidden.length
            ? "先翻开这张牌"
            : a.type === "stash"
              ? "先点暂存格，再移入这张牌"
              : "点这张牌，收入四格槽",
        },
      ];
    }
    if (tool === "magnet") {
      const ts = live(this.s),
        options: [Tile, Tile][] = [];
      for (let i = 0; i < ts.length; i++)
        for (let j = i + 1; j < ts.length; j++)
          if (same(ts[i], ts[j])) options.push([ts[i], ts[j]]);
      // Recover occupied capacity first; bypass covers and the four-slot insertion.
      options.sort(
        (a, b) =>
          b.filter((t) => this.s.tray.includes(t.id)).length -
          a.filter((t) => this.s.tray.includes(t.id)).length,
      );
      const target = options[0];
      if (!target) return [{ type: "notice", text: "没有可吸取的牌对" }];
      this.save();
      this.s.inventory.magnet--;
      if (this.s.experiment) this.s.experiment.streak = 0;
      this.s.moves++;
      const before = [...this.s.tray];
      this.remove(...target);
      const events: Event[] = [
        {
          type: "magnet",
          combo: this.s.combo,
          bestCombo: this.s.bestCombo,
          ids: target.map((t) => t.id),
          trayBefore: before,
          trayAfter: [...this.s.tray],
          text: "磁铁吸取消除一对",
        },
        ...settleBoard(
          this.s,
          true,
          target[0].kind !== "normal",
          !this.simulation,
        ),
        ...this.effects(target[0].kind),
      ];
      if (target[0].bonus) this.settleBonus();
      return events;
    }
    return this.shuffle();
  }
  shuffle(): Event[] {
    // Return held cards to reserved ring slots / their queue order, preserving
    // the stash reservation, then deal and verify a moving-layout witness.
    const original = clone(this.s),
      base = clone(this.s);
    if (base.slotPending !== null && base.tray.includes(base.slotPending))
      base.slot = base.slotPending;
    base.tray = [];
    moveBoard(base);
    relocateBonus(base);
    const groups = new Map<string, Tile[]>();
    live(base)
      .filter((t) => !t.bonus)
      .forEach((t) => {
        const k = t.kind + ":" + (t.kind === "normal" ? t.face : 0);
        groups.set(k, [...(groups.get(k) || []), t]);
      });
    if ([...groups.values()].some((g) => g.length % 2))
      return [{ type: "notice", text: "牌面对数不完整，无法洗牌" }];
    for (let attempt = 0; attempt < 8; attempt++) {
      const trial = clone(base);
      trial.seed = (base.seed + attempt * 7919) >>> 0;
      const assignments: { kind: Tile["kind"]; face: number }[] = [];
      let partner: { kind: Tile["kind"]; face: number } | null = null;
      for (const g of groups.values()) {
        let count = g.length;
        if (g.some((t) => t.id === trial.slot)) {
          partner = { kind: g[0].kind, face: g[0].face };
          count -= 2;
        }
        for (let k = 0; k < count / 2; k++)
          assignments.push({ kind: g[0].kind, face: g[0].face });
      }
      const placed = new Map<number, { kind: Tile["kind"]; face: number }>();
      if (trial.movement?.type === "lines") {
        // A recovery shuffle must preserve the line objective too. Reserve
        // complete visible columns from whole face pairs, then deal the rest
        // by reachable pair order. The actual cascade is certified below.
        const needed = Math.max(
          0,
          trial.movement.target - trial.movement.cleared,
        );
        const columns = trial.movement.columns
          .map((ids) =>
            ids.filter((id) =>
              onBoard(trial, trial.tiles.find((t) => t.id === id)!),
            ),
          )
          .filter((ids) => ids.length >= 6);
        let reserved = 0;
        for (const ids of columns) {
          if (reserved >= needed) break;
          const face = assignments.find(
            (a) =>
              a.kind === "normal" &&
              assignments.filter(
                (b) => b.kind === "normal" && b.face === a.face,
              ).length >= 3,
          );
          if (!face) break;
          for (let i = 0; i < 3; i++)
            assignments.splice(
              assignments.findIndex(
                (a) => a.kind === face.kind && a.face === face.face,
              ),
              1,
            );
          for (const id of ids.slice(0, 6)) {
            placed.set(id, face);
            trial.tiles.find((t) => t.id === id)!.removed = true;
          }
          reserved++;
        }
        moveBoard(trial);
      }
      const take = (face: { kind: Tile["kind"]; face: number }) => {
        const candidates = trial.tiles.filter(
          (t) => !t.bonus && free(trial, t),
        );
        if (!candidates.length) return false;
        const t = candidates[Math.floor(random(trial) * candidates.length)];
        placed.set(t.id, face);
        t.removed = true;
        if (
          trial.movement?.type === "conveyor" ||
          trial.movement?.type === "lines"
        )
          moveBoard(trial);
        return true;
      };
      if (partner && !take(partner)) continue;
      if (partner) moveBoard(trial, true);
      let ok = true;
      for (const face of shuffled(assignments, trial)) {
        if (!take(face) || !take(face)) {
          ok = false;
          break;
        }
        moveBoard(trial, true);
      }
      if (!ok) continue;
      const result = clone(base);
      result.seed = trial.seed;
      for (const t of result.tiles) {
        const p = placed.get(t.id);
        if (p) {
          t.kind = p.kind;
          t.face = p.face;
          t.hidden = false;
        }
      }
      const shuffleBefore = this.boardSnapshot();
      const shuffleAfter = {
        tiles: clone(result.tiles),
        tray: [...result.tray],
        slot: result.slot,
        movement: result.movement ? clone(result.movement) : undefined,
      };
      const cascade =
        result.movement?.type === "lines" ? settleBoard(result) : [];
      if (!solve(result)) continue;
      this.save();
      this.s = result;
      relocateBonus(this.s);
      this.s.inventory.shuffle--;
      this.s.moves++;
      this.s.combo = 0;
      if (this.s.experiment) this.s.experiment.streak = 0;
      return [
        {
          type: "shuffle",
          boardBefore: shuffleBefore,
          boardAfter: shuffleAfter,
          ids: [...placed.keys()],
          trayBefore: [...original.tray],
          trayAfter: [],
          text: "槽内牌已返回牌堆，重新排列",
        },
        ...cascade,
      ];
    }
    return [{ type: "notice", text: "暂未找到可用排列，试试回退或磁铁" }];
  }
  apply(a: Action): Event[] {
    if (a.type === "wait")
      return [
        ...this.advanceBelt(),
        ...this.tickBonus(
          this.s.movement?.type === "belt"
            ? this.s.movement.periodMs
            : this.s.bonus?.remainingMs || 0,
        ),
      ];
    const ev: Event[] = [];
    if (a.type === "stash") {
      const t = this.s.tiles.find((t) => t.id === a.a);
      if (t?.hidden) ev.push(...this.tap(a.a));
      if (!this.s.slotOpen && (this.s.stashCharges || 0) > 0)
        ev.push(...this.toggleStash());
      this.stashMode = true;
      ev.push(...this.tap(a.a));
      return ev;
    }
    for (const id of a.type === "pair" ? [a.a, a.b] : [a.a]) {
      const t = this.s.tiles.find((t) => t.id === id);
      if (!t || t.removed || this.s.tray.includes(id)) continue;
      if (t.hidden) ev.push(...this.tap(id));
      ev.push(...this.tap(id));
    }
    return ev;
  }
}

// Dependency inversion: the dynamic oracle executes the actual engine, including
// bombs, gifts and PRNG. solver.ts never imports this module or approximates effects.
registerTransition((state, action) => {
  const p = new Puzzle({
    id: state.levelId || 15,
    name: "search",
    subtitle: "",
    difficulty: 1,
    seed: state.seed,
    source: "search",
    tiles: [],
  });
  p.s = clone(state);
  p.save = () => {};
  p.simulation = true;
  p.apply(action);
  return p.s;
});
