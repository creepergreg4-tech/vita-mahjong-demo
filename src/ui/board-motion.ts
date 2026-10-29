import type { FidelityScene } from "../scenes/FidelityScene";
import {
  onBoard,
  queueDepth,
  type State,
  type Tile,
  type Position,
} from "../core/model";

/** Fixed board projection: removing cards never makes the remaining board jump. */
export class BoardMotionView {
  constructor(private scene: FidelityScene) {}
  geometry() {
    const g = this.scene,
      ts = g.p.level.tiles;
    const actor = g.p.level.experiment?.type;
    if (g.p.level.movement?.type === "lines") {
      const w = Math.min(82, 505 / 6.2, (g.H * 0.55) / (6 * 1.23));
      return {
        minX: 0,
        minY: 0,
        left: (540 - 5.2 * w) / 2,
        top: g.H * 0.335,
        w,
        h: w * 1.23,
      };
    }
    if (g.p.level.movement?.type === "conveyor") {
      const w = Math.min(85, (g.H * 0.49) / (5 * 1.23));
      return {
        minX: 0,
        minY: 0,
        left: (540 - 4.8 * w) / 2,
        top: g.H * (g.p.level.id >= 22 ? 0.34 : 0.29),
        w,
        h: w * 1.23,
      };
    }
    const minX = Math.min(...ts.map((t) => t.x)),
      maxX = Math.max(...ts.map((t) => t.x));
    const minY = Math.min(...ts.map((t) => t.y)),
      maxY = Math.max(...ts.map((t) => t.y));
    const top = g.H * (g.p.level.id >= 22 || actor === "dragon" ? 0.3 : 0.235),
      bottom = g.H * (actor === "dragon" ? 0.8 : 0.84);
    const w = Math.min(
      85,
      (actor === "slots" ? 408 : 505) / (maxX - minX + 1.08),
      (bottom - top) / (maxY - minY + 1.12) / 1.23,
    );
    return {
      minX,
      minY,
      left: ((actor === "slots" ? 430 : 540) - (maxX - minX) * w) / 2,
      top: (top + bottom - (maxY - minY) * w * 1.23) / 2,
      w,
      h: w * 1.23,
    };
  }
  position(p: Position & { bonus?: true }) {
    if (p.bonus && p.y < 0)
      return { x: p.x < 2.5 ? 65 : 475, y: this.scene.H * 0.24 };
    const a = this.geometry();
    if (this.scene.p.level.movement?.type === "lines")
      return {
        x: a.left + (p.x / 1.2) * 1.04 * a.w,
        y: a.top + Math.max(-0.86, p.y) * a.h,
      };
    const y =
      this.scene.p.level.movement?.type === "conveyor"
        ? Math.min(p.y, 5.15)
        : p.y;
    return {
      x: a.left + (p.x - a.minX) * a.w - p.z * 0.8,
      y: a.top + (y - a.minY) * a.h - p.z * 1.2,
    };
  }
  visible(state: State, t: Tile) {
    return (
      onBoard(state, t) &&
      (state.movement?.type !== "lines" || (t.y >= 0 && t.y < 6)) &&
      (state.movement?.type !== "conveyor" || queueDepth(state, t) < 5)
    );
  }
  decorate(state: State) {
    const g = this.scene,
      m = state.movement;
    if (!m) return;
    const a = this.geometry();
    g.txt(
      g.board,
      270,
      g.H * 0.227,
      m.type === "ring"
        ? m.reversible
          ? "回流棋局 · 普通牌顺转，特殊牌逆转"
          : "顺着箭头 · 每配对一次，外圈走一格"
        : m.type === "lines"
          ? "只取底牌 · 取走即下落 · 六张同牌清整线"
          : m.type === "belt"
            ? "定时传送 · 停稳后选牌"
            : "只取最上方 · 取走一张，立即补位",
      14,
      "#dbd7a9",
    ).setName("motionCaption");
    const rails = g.add.graphics();
    g.board.add(rails);
    if (m.type === "ring") {
      const center = { x: 270, y: g.H * 0.54 };
      m.path.forEach((p, i) => {
        const direction = m.reversible ? g.flowDirection : 1;
        const next = m.path[(i + direction + m.path.length) % m.path.length],
          from = this.position(p),
          to = this.position(next);
        rails
          .lineStyle(4, 0x1c3023, 0.8)
          .lineBetween(from.x, from.y, to.x, to.y);
        const mx = (from.x + to.x) / 2,
          my = (from.y + to.y) / 2;
        const horizontal = Math.abs(to.x - from.x) > Math.abs(to.y - from.y);
        const x = horizontal ? mx : mx + (mx < center.x ? -1 : 1) * a.w * 0.51;
        const y = horizontal ? my + (my < center.y ? -1 : 1) * a.h * 0.51 : my;
        const angle = Math.atan2(to.y - from.y, to.x - from.x),
          dx = Math.cos(angle),
          dy = Math.sin(angle);
        rails
          .lineStyle(2.5, 0xe0bc6a, 0.9)
          .beginPath()
          .moveTo(x - dx * 5 - dy * 4, y - dy * 5 + dx * 4)
          .lineTo(x + dx * 2, y + dy * 2)
          .lineTo(x - dx * 5 + dy * 4, y - dy * 5 - dx * 4)
          .strokePath();
      });
    } else if (m.type === "belt") {
      const horizontal = m.direction === "left" || m.direction === "right";
      const sign = m.direction === "left" || m.direction === "up" ? -1 : 1;
      const arrow = ({ left: "←", right: "→", up: "↑", down: "↓" } as const)[
        m.direction
      ];
      for (let i = 0; i < m.path.length; i += m.laneLength) {
        const first = this.position(m.path[i]),
          last = this.position(m.path[i + m.laneLength - 1]);
        rails
          .lineStyle(8, 0x193c30, 0.7)
          .lineBetween(first.x, first.y, last.x, last.y);
        for (let j = 0; j < m.laneLength; j++) {
          const p = this.position(m.path[i + j]);
          const x = p.x + (horizontal ? 0 : a.w * 0.52),
            y = p.y + (horizontal ? a.h * 0.52 : 0);
          g.txt(g.board, x, y, arrow, 14, "#d9b966");
        }
        const edge = sign > 0 ? last : first;
        g.txt(
          g.board,
          edge.x + (horizontal ? sign * a.w * 0.51 : 0),
          edge.y + (horizontal ? 0 : sign * a.h * 0.51),
          arrow,
          18,
          "#ffdb83",
        );
      }
    } else if (m.type === "lines") {
      m.columns.forEach((ids, index) => {
        const x = this.position({ x: index * 1.2, y: 0, z: 0 }).x;
        const top = a.top - a.h * 0.52,
          bottom = a.top + 5.52 * a.h;
        rails
          .fillStyle(0x183d31, 0.55)
          .fillRoundedRect(x - a.w * 0.52, top, a.w * 1.04, bottom - top, 8)
          .lineStyle(1, 0xb89550, 0.45)
          .strokeRoundedRect(x - a.w * 0.52, top, a.w * 1.04, bottom - top, 8);
        for (let y = 0; y < 6; y++) {
          rails
            .lineStyle(
              y === 5 ? 2.5 : 1,
              y === 5 ? 0xffdc81 : 0x9f8f5c,
              y === 5 ? 0.95 : 0.3,
            )
            .strokeRoundedRect(
              x - a.w * 0.49,
              a.top + y * a.h - a.h * 0.48,
              a.w * 0.98,
              a.h * 0.96,
              7,
            );
        }
        const remaining = ids
          .map((id) => state.tiles.find((t) => t.id === id)!)
          .filter((t) => onBoard(state, t) && t.y < 0);
        const next = remaining.find((t) => t.y === -1),
          p = this.position({ x: index * 1.2, y: -1, z: 0 });
        if (next) {
          const card = g
            .card(next, 34, 42)
            .setPosition(p.x - 13, p.y)
            .setAlpha(0.9);
          g.board.add(card);
          g.hit(card, 0, 0, 34, 42, () => g.tap(next.id));
        }
        g.txt(
          g.board,
          p.x + (next ? 20 : 0),
          p.y,
          `↓${remaining.length}`,
          14,
          "#ccb886",
        );
      });
    } else {
      m.columns.forEach((ids, index) => {
        const x = this.position({ x: index * 1.2, y: 0, z: 0 }).x;
        const top = a.top - a.h * 0.52,
          bottom = a.top + 4.55 * a.h;
        rails
          .fillStyle(0x183d31, 0.75)
          .fillRoundedRect(x - a.w * 0.53, top, a.w * 1.06, bottom - top, 10)
          .lineStyle(1, 0xb89550, 0.5)
          .strokeRoundedRect(x - a.w * 0.53, top, a.w * 1.06, bottom - top, 10)
          .lineStyle(2, 0xe4c87f, 0.95)
          .strokeRoundedRect(
            x - a.w * 0.52,
            a.top - a.h * 0.51,
            a.w * 1.04,
            a.h * 1.02,
            8,
          );
        const y = a.top + 5.15 * a.h;
        g.fit(g.board, x, y, "f.home.leafCounterBackground", a.w * 0.97, 43);
        const queued = ids.filter((id) => {
          const t = state.tiles.find((t) => t.id === id);
          return t && onBoard(state, t) && queueDepth(state, t) >= 5;
        }).length;
        g.txt(g.board, x, y, `↑ ${queued}`, 21, "#ffe8af");
      });
    }
  }
}
