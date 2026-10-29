import type Phaser from "phaser";
import type { FidelityScene } from "../scenes/FidelityScene";
import { free, type Event, type State } from "../core/model";

/** One teaching move, then the board is the puzzle. No permanent free hint. */
export class LineModeView {
  visibleCleared = 0;
  phase = "";
  private cursor = 0;
  private guided = true;
  private signature = "";
  private guide?: Phaser.GameObjects.Container;
  private announcement?: Phaser.GameObjects.Container;
  get announcing() {
    return !!this.announcement?.active;
  }
  constructor(private g: FidelityScene) {
    this.sync();
  }
  sync() {
    const m = this.g.p.s.movement;
    if (m?.type === "lines") this.visibleCleared = m.cleared;
  }
  action(id: number) {
    const route = this.g.p.level.lineGuide || [];
    if (route[this.cursor] === id) this.cursor++;
    else this.guided = false;
  }
  tool() {
    this.guided = false;
    this.clearGuide();
  }
  clearGuide() {
    if (this.guide) {
      this.g.tweens.killTweensOf(this.guide.getAll());
      this.guide.destroy();
      this.guide = undefined;
    }
    this.phase = "";
  }
  refresh() {
    const g = this.g,
      m = g.p?.s.movement;
    if (g.mode !== "play" || m?.type !== "lines") {
      this.clearGuide();
      return;
    }
    const sig = [
      g.pending,
      g.epoch,
      !!g.modal,
      !!g.dmElement,
      g.transition,
      g.p.s.moves,
      m.cleared,
      this.cursor,
      this.guided,
    ].join("/");
    if (sig === this.signature) return;
    this.signature = sig;
    this.clearGuide();
    if (
      g.pending ||
      g.modal ||
      g.dmElement ||
      g.transition ||
      !this.guided ||
      g.saveData.tutorials.includes("lines-v1") ||
      m.cleared
    )
      return;
    const id = g.p.level.lineGuide?.[this.cursor],
      t = g.p.s.tiles.find((t) => t.id === id);
    if (!t || !free(g.p.s, t)) return;
    g.notice?.destroy();
    g.notice = undefined;
    const p = g.currentPoint(t.id),
      c = g.add.container().setDepth(150);
    this.guide = c;
    this.phase = "opening";
    const y = g.H * 0.218;
    c.add(
      g.add
        .graphics()
        .fillStyle(0x153b2b, 0.94)
        .fillRoundedRect(18, y - 20, 504, 40, 10)
        .lineStyle(1, 0xc5a25c, 0.8)
        .strokeRoundedRect(18, y - 20, 504, 40, 10),
    );
    g.txt(
      c,
      270,
      y,
      this.cursor === 0
        ? "先取这张底牌，观察上方落下后能否连成一线"
        : "继续选择底牌，让六张同牌排成整线",
      16,
      "#ffe6a5",
    );
    const ring = g.add
      .circle(p.x, p.y, 25)
      .setStrokeStyle(3, 0xffe39a)
      .setFillStyle(0, 0);
    c.add(ring);
    const hand = g.add
      .image(p.x + 4, p.y + 4, "f.play.guideHand")
      .setOrigin(0.1, 0.055)
      .setDisplaySize(62, 90);
    c.add(hand);
    g.tweens.add({
      targets: ring,
      scale: 1.3,
      alpha: 0.2,
      duration: 750,
      repeat: -1,
    });
    g.tweens.add({
      targets: hand,
      scaleX: hand.scaleX * 0.9,
      scaleY: hand.scaleY * 0.9,
      duration: 420,
      yoyo: true,
      repeat: -1,
    });
  }
  drawGoal() {
    const g = this.g,
      m = g.p.s.movement;
    if (m?.type !== "lines") return;
    const p = g.stashPoint();
    g.hud.add(
      g.add
        .graphics()
        .fillStyle(0x23170e, 0.9)
        .fillRoundedRect(p.x - 40, p.y - 45, 80, 90, 10)
        .lineStyle(2, 0xd4ad5c)
        .strokeRoundedRect(p.x - 40, p.y - 45, 80, 90, 10),
    );
    g.txt(g.hud, p.x, p.y - 27, "整线目标", 14, "#e9d59e");
    g.txt(
      g.hud,
      p.x,
      p.y + 5,
      `${this.visibleCleared}/${m.target}`,
      28,
      "#ffe8a7",
    );
    g.txt(g.hud, p.x, p.y + 53, "并清空牌", 13, "#aebda1");
  }
  async clear(e: Event) {
    const g = this.g,
      epoch = g.epoch;
    if (e.boardBefore) g.renderBoard({ ...g.p.s, ...e.boardBefore } as State);
    this.clearGuide();
    const ids = e.ids || [],
      points = ids
        .map((id) => g.boardPoints.get(id))
        .filter((p): p is { x: number; y: number } => !!p);
    const lights: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < ids.length; i++) {
      const p = g.boardPoints.get(ids[i]);
      if (!p) continue;
      g.tileViews.get(ids[i])?.setAlpha(1);
      const light = g.add
        .image(p.x, p.y, "reward.et_glow_001")
        .setDisplaySize(g.boardW * 1.35, g.boardH * 1.25)
        .setTint(0xffe690)
        .setAlpha(0)
        .setDepth(82);
      lights.push(light);
      g.tweens.add({
        targets: light,
        alpha: 0.85,
        duration: 90,
        delay: i * 45,
        yoyo: true,
        hold: 180,
      });
    }
    g.sfx("hint");
    await g.sleep(340);
    if (epoch !== g.epoch) return;
    if (points.length) {
      const a = points[0],
        b = points.at(-1)!;
      const streak = g.add
        .image(a.x, a.y, "reward.et_trail_032")
        .setDisplaySize(105, 24)
        .setAngle((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI)
        .setDepth(90);
      g.tweens.add({
        targets: streak,
        x: b.x,
        y: b.y,
        duration: 210,
        ease: "Sine.InOut",
        onComplete: () => streak.destroy(),
      });
    }
    await g.sleep(190);
    if (epoch !== g.epoch) return;
    for (const id of ids) {
      const p = g.boardPoints.get(id);
      if (p) g.shatter(p.x, p.y);
      g.tileViews.get(id)?.setVisible(false);
    }
    g.sfx("match");
    this.visibleCleared = e.clearedCount ?? this.visibleCleared + 1;
    g.renderHud();
    g.drawIQ();
    g.learn("lines-v1");
    const label = g.add.container(270, g.H * 0.225).setDepth(140);
    this.announcement?.destroy();
    this.announcement = label;
    g.txt(
      label,
      0,
      0,
      e.orientation === "column" ? "整列消除！" : "整行消除！",
      26,
      "#ffe6a1",
    ).setStroke("#67501c", 3);
    g.tweens.add({
      targets: label,
      y: label.y - 8,
      alpha: 0,
      delay: 500,
      duration: 350,
      onComplete: () => label.destroy(),
    });
    await g.sleep(180);
    if (epoch !== g.epoch) return;
    lights.forEach((x) => x.destroy());
    if (e.boardAfter) g.renderBoard({ ...g.p.s, ...e.boardAfter } as State);
  }
}
