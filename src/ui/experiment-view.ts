import Phaser from "phaser";
import type { FidelityScene } from "../scenes/FidelityScene";
import type { Event } from "../core/model";
type Point = { x: number; y: number };
const resultIcons: Record<string, string> = {
  pairMove: "ui.move",
  pairBomb: "effects.firecracker",
  fire: "effects.firecracker",
  hint: "ui.hint",
  undo: "ui.undo",
  magnet: "ui.magnet",
  shuffle: "ui.shuffle",
  iq: "f.play.iqLabel",
};

export class ExperimentView {
  heads: Phaser.GameObjects.Image[] = [];
  machine?: Phaser.GameObjects.Sprite;
  reel?: Phaser.GameObjects.Image;
  lastResult = "";
  lastOrigin?: Point;
  constructor(private g: FidelityScene) {}
  origin(e?: Event): Point {
    if (e && e.activation === undefined && this.lastOrigin)
      return this.lastOrigin;
    const g = this.g,
      cfg = g.p.s.experiment;
    if (cfg?.type === "slots") return { x: 490, y: g.H * 0.45 + 39 };
    const n = e?.activation ?? (cfg?.activations || 0) + 1;
    const bottom = (cfg?.position === "bottom") !== ((n - 1) % 2 === 1);
    return { x: 270, y: g.H * (bottom ? 0.85 : 0.228) + 20 };
  }
  draw() {
    const g = this.g,
      e = g.p.s.experiment;
    if (!e) return;
    this.heads = [];
    const left = Math.max(0, e.maxActivations - e.activations);
    if (e.type === "dragon") {
      for (const y of [g.H * 0.228, g.H * 0.85]) {
        const head = g.fit(g.hud, 270, y, "experiment.dragon", 104, 104);
        this.heads.push(head);
      }
      g.txt(
        g.hud,
        105,
        g.H * 0.228,
        `手动连消 ${e.streak}/${e.threshold}`,
        17,
        "#f3d891",
      );
      g.txt(
        g.hud,
        435,
        g.H * 0.228,
        left ? `自动吐牌 · 余${left}` : "龙息已歇",
        15,
        "#d8bc7e",
      );
      for (let i = 0; i < e.threshold; i++)
        g.img(
          g.hud,
          91 + i * 28,
          g.H * 0.25,
          "reward.et_glow_001",
          i < e.streak ? 18 : 10,
          i < e.streak ? 18 : 10,
        )
          .setTint(0xffd665)
          .setAlpha(i < e.streak ? 1 : 0.35);
    } else {
      g.txt(g.hud, 490, g.H * 0.45 - 70, "好运转轮", 16, "#f6df9c");
      this.machine = g
        .nativeFx!.spawn("slotIdle", { x: 490, y: g.H * 0.45 }, 170, 10)
        .setOrigin(0.5, 0.31);
      g.hud.add(this.machine);
      this.reel = g.add
        .image(490, g.H * 0.45, "ui.gift")
        .setDisplaySize(36, 36);
      g.hud.add(this.reel);
      g.txt(
        g.hud,
        490,
        g.H * 0.45 + 79,
        `${e.streak}/${e.threshold} 连消`,
        16,
        "#f5dfb2",
      );
      g.txt(
        g.hud,
        490,
        g.H * 0.45 + 100,
        left ? `剩 ${left} 次` : "本关已领完",
        14,
        "#a7c4b5",
      );
      if (this.lastResult) this.setReel(resultIcons[this.lastResult]);
    }
  }
  private setReel(key: string) {
    if (!this.reel?.active) return;
    this.reel.setTexture(key);
    const im = this.g.textures.get(key).getSourceImage();
    const scale = Math.min(36 / im.width, 36 / im.height);
    this.reel.setDisplaySize(im.width * scale, im.height * scale);
  }
  async play(e: Event) {
    const g = this.g,
      epoch = g.epoch,
      alive = () => g.epoch === epoch && g.mode === "play";
    g.hardLock = true;
    const from = this.origin(e);
    this.lastOrigin = from;
    if (e.actor === "slots") {
      const choices = Object.values(resultIcons);
      for (let i = 0; i < 10; i++) {
        this.setReel(choices[i % choices.length]);
        g.sfx("button");
        await g.sleep(55 + i * 4);
        if (!alive()) return;
      }
      this.lastResult = e.result || "hint";
      this.setReel(resultIcons[this.lastResult]);
      this.machine?.setVisible(false);
      await g.nativeFx!.play(
        "slotSpitting",
        { x: 490, y: g.H * 0.45 + 170 * 1.5 * (0.5 - 0.31) },
        170,
        85,
      );
      if (!alive()) return;
      this.machine?.setVisible(true);
    } else {
      const index = from.y > g.H * 0.5 ? 1 : 0,
        head = this.heads[index];
      if (head?.active) {
        const sx = head.scaleX,
          sy = head.scaleY;
        await g.tween(head, {
          scaleX: sx * 1.14,
          scaleY: sy * 0.9,
          duration: 120,
          yoyo: true,
        });
        if (!alive()) return;
      }
      g.nativeFx!.stars(from, 10);
      g.sfx("firecrackerFly");
    }
    if (e.result === "pairMove" || e.result === "pairBomb") {
      await Promise.all(
        (e.ids || []).map(async (id, i) => {
          const t = g.p.s.tiles.find((t) => t.id === id)!;
          const to = g.motionView!.position(t);
          const card = g
            .card(t, g.boardW, g.boardH)
            .setPosition(from.x, from.y)
            .setScale(0.35)
            .setDepth(110);
          await g.tween(card, {
            x: to.x,
            y: to.y,
            scale: 1,
            duration: 450,
            delay: i * 90,
            ease: "Cubic.Out",
          });
          card.destroy();
          if (alive()) g.nativeFx!.stars(to, 10);
        }),
      );
      if (!alive()) return;
      g.renderBoard();
      this.message(e.text || "送来一对特殊牌");
    } else if (e.result === "iq") {
      await g.nativeFx!.fly(
        "f.play.iqLabel",
        from,
        { x: 270, y: g.H * 0.075 },
        70,
        500,
      );
      if (!alive()) return;
      g.visualBonusIQ = g.p.s.bonusIQ || 0;
      g.drawIQ();
      g.nativeFx!.stars({ x: 270, y: g.H * 0.075 }, 18);
      g.toast(e.text || "智慧积分增加", 1800);
    } else if (e.result === "fire") {
      this.message("龙息 · 收取亮起的一对");
    }
    if (alive()) g.hardLock = false;
  }
  private message(text: string) {
    const g = this.g;
    if (g.p.s.experiment?.type !== "dragon") {
      g.toast(text, 1600);
      return;
    }
    const c = g.add.container(270, g.H * 0.285).setDepth(130);
    g.txt(c, 0, 0, text, 16, "#ffe7aa").setStroke("#194938", 3);
    g.tweens.add({
      targets: c,
      alpha: 0,
      delay: 1100,
      duration: 250,
      onComplete: () => c.destroy(),
    });
  }
}
