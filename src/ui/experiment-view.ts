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
  reelBacking?: Phaser.GameObjects.Image;
  lastFaces: number[] = [];
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
      g.txt(g.hud, 490, g.H * 0.45 - 70, "叠牌转轮", 16, "#f6df9c");
      this.machine = g
        .nativeFx!.spawn("slotIdle", { x: 490, y: g.H * 0.45 }, 170, 10)
        .setOrigin(0.5, 0.31);
      g.hud.add(this.machine);
      this.reelBacking = g.img(g.hud, 490, g.H * 0.45, "f.play.tilePlainBlue", 43, 53);
      const sample = g.p.s.tiles.find(t => t.kind === "normal");
      this.reel = g.add
        .image(490, g.H * 0.45, sample ? g.faceKey(sample) : "faces.dot2")
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
        left ? `剩 ${left} 次` : "本关已结束",
        14,
        "#a7c4b5",
      );
      if (this.lastResult === "stackNormal" && this.lastFaces.length && sample) {
        this.setReel(g.faceKey({...sample, face: this.lastFaces[0]}));
        this.lastFaces.forEach((face, i) => {
          const tile = g.card({...sample, face, hidden: false}, 24, 30)
            .setPosition(461 + i * 29, g.H * 0.45 + 137);
          g.hud.add(tile);
        });
        g.txt(g.hud, 490, g.H * 0.45 + 166, "本轮牌样", 12, "#e4c98f");
      } else if (this.lastResult) this.setReel(resultIcons[this.lastResult]);
    }
  }
  private setReel(key: string) {
    if (!this.reel?.active || !key) return;
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
    // Earlier gift/flip effects may have redrawn the final engine state. Restore
    // this event's pre-delivery board so emitted cards cannot appear twice.
    if (e.boardBefore) g.renderBoard({ ...g.p.s, ...e.boardBefore });
    const from = this.origin(e);
    this.lastOrigin = from;
    if (e.actor === "slots") {
      const samples = g.p.s.tiles.filter(t => t.kind === "normal" && !t.removed);
      const faceChoices = [...new Set(samples.map(t => g.faceKey(t)))].slice(0, 6);
      const choices = [...faceChoices, "ui.move", "effects.firecracker", "ui.hint"];
      for (let i = 0; i < 10; i++) {
        this.setReel(choices[i % choices.length]);
        g.sfx("button");
        await g.sleep(55 + i * 4);
        if (!alive()) return;
      }
      this.lastResult = e.result || "hint";
      this.lastFaces = e.previewFaces || [];
      const emitted = e.result === "stackNormal" ? g.p.s.tiles.find(t => t.id === e.ids?.[0]) : undefined;
      this.setReel(emitted ? g.faceKey(emitted) : resultIcons[this.lastResult]);
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
    if (e.result === "pairMove" || e.result === "pairBomb" || e.result === "stackNormal") {
      // Build ordinary stacks from the bottom up; no two flying matching tiles
      // collide or auto-collect. They land into the board's normal blocking rules.
      const ordered = [...(e.ids || [])].sort((a, b) =>
        (g.p.s.tiles.find(t => t.id === a)?.z || 0) -
        (g.p.s.tiles.find(t => t.id === b)?.z || 0));
      const landed: Phaser.GameObjects.Container[] = [];
      for (let i = 0; i < ordered.length; i++) {
          const id = ordered[i];
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
            duration: e.result === "stackNormal" ? 240 : 380,
            ease: "Cubic.Out",
          });
          if (!alive()) { card.destroy(); landed.forEach(c => c.destroy()); return; }
          landed.push(card);
          if (alive()) g.nativeFx!.stars(to, 10);
      }
      if (!alive()) return;
      g.renderBoard();
      landed.forEach(c => c.destroy());
      this.message(e.text || "新牌已叠放 · 先找解法");
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
