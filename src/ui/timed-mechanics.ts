import Phaser from "phaser";
import type { FidelityScene } from "../scenes/FidelityScene";
import { clone } from "../core/model";

/** Active-play clock: menus, hidden tabs and game animations never consume the opportunity. */
export class TimedMechanics {
  beltElapsed = 0;
  private saveElapsed = 0;
  private caption?: Phaser.GameObjects.Text;
  constructor(private scene: FidelityScene) {}
  draw() {
    const g = this.scene;
    this.caption = g
      .txt(g.hud, 270, g.H * 0.242, "", 18, "#ffe5a3")
      .setStroke("#294d35", 3)
      .setVisible(false);
  }
  update(dt: number) {
    const g = this.scene;
    if (g.mode !== "play" || !g.p) return;
    const p = g.p,
      bonus = p.s.bonus,
      playing =
        g.paused === null &&
        !g.modal &&
        !g.dmElement &&
        !document.hidden &&
        !g.transition &&
        !g.hardLock;
    const active = playing && !g.pending;
    const step = Math.min(100, Math.max(0, dt));
    const recovery =
      !!g.modal?.getData("fullTray") &&
      bonus?.status === "active" &&
      bonus.ids.some((id) => p.s.tray.includes(id));
    if (recovery && !g.pending && !g.dmElement && !document.hidden) {
      const text = g.modal?.getByName(
        "bonusRecovery",
      ) as Phaser.GameObjects.Text | null;
      text?.setText(
        `限时礼盒 ${Math.ceil(bonus.remainingMs / 1000)} 秒后消退并腾出空位`,
      );
      const expired = p.tickBonus(step);
      if (expired.length) {
        if (!p.full) g.closePanel();
        g.dispatch(expired);
        return;
      }
    }
    const belt = p.s.movement;
    if (
      playing &&
      belt?.type === "belt" &&
      !g.motionPending &&
      !g.input.activePointer.isDown
    )
      this.beltElapsed = Math.min(belt.periodMs, this.beltElapsed + step);
    if (active && !p.won) {
      const spawned = g.comboFx?.isPresent() ? [] : p.startBonus();
      if (spawned.length) {
        g.dispatch(spawned);
        return;
      }
      const expired = p.tickBonus(step);
      if (expired.length) {
        g.dispatch(expired);
        return;
      }
      const m = p.s.movement;
      if (m?.type === "belt" && !g.input.activePointer.isDown) {
        if (this.beltElapsed >= m.periodMs) {
          const before = clone(p.s);
          this.beltElapsed = 0;
          g.dispatch(p.advanceBelt(), undefined, before);
          return;
        }
      }
      if (bonus?.status === "active" || m?.type === "belt") {
        this.saveElapsed += step;
        if (this.saveElapsed >= 1000) {
          this.saveElapsed = 0;
          g.persist();
        }
      }
    }
    const m = p.s.movement,
      motion = g.board.getByName(
        "motionCaption",
      ) as Phaser.GameObjects.Text | null;
    if (m?.type === "belt" && motion) {
      const seconds = Math.max(
        1,
        Math.ceil((m.periodMs - this.beltElapsed) / 1000),
      );
      const arrow = ({ up: "↑", right: "→", down: "↓", left: "←" } as const)[
        m.direction
      ];
      motion
        .setText(
          `${arrow} 定时传送 · ${seconds === 1 ? "即将移动" : `${seconds} 秒后移动`}`,
        )
        .setColor(seconds === 1 ? "#ffe681" : "#dbd7a9");
    }
    const visible = bonus?.status === "active";
    this.caption?.setVisible(
      !!visible && !g.notice?.active && !g.modal && !g.dmElement,
    );
    if (visible) {
      this.caption?.setText(
        `${bonus.remainingMs > 10500 ? "狂暴时刻" : "限时礼盒"} · ${Math.ceil(bonus.remainingMs / 1000)} 秒`,
      );
      motion?.setVisible(false);
      const ratio = Phaser.Math.Clamp(bonus.remainingMs / 12000, 0, 1);
      for (const id of bonus.ids) {
        const card = g.tileViews.get(id) || g.trayViews.get(id);
        if (!card?.active) continue;
        const height =
          card.getData("cardHeight") || (g.trayViews.has(id) ? 77 : g.boardH);
        const edge = -height * 0.5 + height * ratio;
        for (const child of card.list) {
          if (
            child instanceof Phaser.GameObjects.Container &&
            child.name === "bonusBadge"
          ) {
            child.setAlpha(0.45 + 0.55 * ratio).setVisible(ratio > 0.14);
          }
          if (!(child instanceof Phaser.GameObjects.Image)) continue;
          const top = child.y - child.displayHeight * child.originY;
          const crop = Phaser.Math.Clamp(
            (edge - top) / child.scaleY,
            0,
            child.frame.realHeight,
          );
          child
            .setCrop(0, 0, child.frame.realWidth, crop)
            .setAlpha(0.45 + 0.55 * ratio);
        }
      }
    }
  }
}
