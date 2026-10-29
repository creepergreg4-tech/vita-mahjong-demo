import Phaser from "phaser";
import type { FidelityScene } from "../scenes/FidelityScene";
import type { Event, Tool } from "../core/model";

export interface NativeClip {
  pages: { file: string; frames: number }[];
  frameWidth: number;
  frameHeight: number;
  fps: number;
  duration: number;
  loop: boolean;
}
export interface NativeClips {
  animations: Record<string, NativeClip>;
}
type Point = { x: number; y: number };
const names: Record<string, string> = {
  hint: "线索",
  undo: "回退",
  magnet: "磁铁",
  shuffle: "洗牌",
  move: "暂存机会",
  bomb: "爆破",
  veil: "小小迷雾",
};

/** Native skeleton frames and original particle textures; choreography is explicit and inspectable. */
export class NativeEffects {
  stage = "idle";
  private blasts = new Map<
    number,
    { ids: number[]; from: Point; dragon: boolean; started: boolean }
  >();
  constructor(private g: FidelityScene) {}
  static preload(g: FidelityScene, clips: NativeClips) {
    for (const [name, clip] of Object.entries(clips.animations)) {
      if (
        !["giftOpen", "giftGlow", "bomb", "slotIdle", "slotSpitting"].includes(
          name,
        )
      )
        continue;
      clip.pages.forEach((page, i) =>
        g.load.spritesheet(
          `native.${name}.${i}`,
          page.file.replace(/^\//, ""),
          { frameWidth: clip.frameWidth, frameHeight: clip.frameHeight },
        ),
      );
    }
  }
  initialize() {
    const g = this.g;
    const embers = g.textures.get("reward.et_fire_002");
    for (let i = 0; i < 16; i++)
      if (!embers.has(`ember${i}`))
        embers.add(
          `ember${i}`,
          0,
          (i % 4) * 64,
          Math.floor(i / 4) * 64,
          64,
          64,
        );
    for (const [name, clip] of Object.entries(g.app.nativeClips.animations)) {
      if (
        !g.textures.exists(`native.${name}.0`) ||
        g.anims.exists(`native.${name}`)
      )
        continue;
      g.anims.create({
        key: `native.${name}`,
        frames: clip.pages.flatMap((p, i) =>
          g.anims.generateFrameNumbers(`native.${name}.${i}`, {
            start: 0,
            end: p.frames - 1,
          }),
        ),
        frameRate: clip.fps,
        repeat: 0,
      });
    }
  }
  spawn(name: string, p: Point, size: number, depth = 100) {
    const clip = this.g.app.nativeClips.animations[name];
    return this.g.add
      .sprite(p.x, p.y, `native.${name}.0`, 0)
      .setDisplaySize(size, (size * clip.frameHeight) / clip.frameWidth)
      .setDepth(depth);
  }
  async play(name: string, p: Point, size: number, depth = 100) {
    const sprite = this.spawn(name, p, size, depth);
    await new Promise<void>((resolve) => {
      sprite.once("animationcomplete", () => {
        sprite.destroy();
        resolve();
      });
      sprite.once("destroy", () => resolve());
      sprite.play(`native.${name}`);
    });
  }
  stars(p: Point, count = 12, color = 0xffdf8c) {
    const g = this.g;
    for (let i = 0; i < count; i++) {
      const a = (i * Math.PI * 2) / count,
        d = 28 + Math.random() * 50;
      const s = g.add
        .image(p.x, p.y, "reward.et_star_002")
        .setDisplaySize(7 + Math.random() * 12, 7 + Math.random() * 12)
        .setTint(color)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(125);
      g.tweens.add({
        targets: s,
        x: p.x + Math.cos(a) * d,
        y: p.y + Math.sin(a) * d,
        angle: 90,
        alpha: 0,
        scaleX: 0,
        scaleY: 0,
        duration: 420 + Math.random() * 180,
        onComplete: () => s.destroy(),
      });
    }
  }
  async fly(key: string, from: Point, to: Point, size = 70, duration = 540) {
    const g = this.g,
      epoch = g.epoch;
    const source = g.textures.get(key).getSourceImage(),
      factor = Math.min(size / source.width, size / source.height);
    const icon = g.add
      .image(from.x, from.y, key)
      .setDisplaySize(source.width * factor, source.height * factor)
      .setDepth(120);
    const sx = icon.scaleX,
      sy = icon.scaleY;
    const bend = to.x < from.x ? -75 : 75;
    const curve = new Phaser.Curves.CubicBezier(
      new Phaser.Math.Vector2(from.x, from.y),
      new Phaser.Math.Vector2(from.x + bend, from.y - 90),
      new Phaser.Math.Vector2(to.x + bend * 0.35, to.y - 90),
      new Phaser.Math.Vector2(to.x, to.y),
    );
    const cursor = { t: 0 };
    let last = -1;
    await new Promise<void>((resolve) => {
      icon.once("destroy", resolve);
      g.tweens.add({
        targets: cursor,
        t: 1,
        duration,
        ease: "Cubic.In",
        onUpdate: () => {
          if (epoch !== g.epoch || !icon.active) return;
          const p = curve.getPoint(cursor.t);
          icon
            .setPosition(p.x, p.y)
            .setScale(sx * (1 - cursor.t * 0.35), sy * (1 - cursor.t * 0.35));
          const n = Math.floor(cursor.t * 18);
          if (n !== last) {
            last = n;
            const dot = g.add
              .image(p.x, p.y, "reward.et_star_002")
              .setDisplaySize(9, 9)
              .setTint(0xffdc76)
              .setBlendMode(Phaser.BlendModes.ADD)
              .setDepth(119);
            g.tweens.add({
              targets: dot,
              alpha: 0,
              scaleX: 0,
              scaleY: 0,
              duration: 260,
              onComplete: () => dot.destroy(),
            });
          }
        },
        onComplete: () => {
          icon.destroy();
          resolve();
        },
        onStop: () => {
          icon.destroy();
          resolve();
        },
      });
    });
  }
  async gift(e: Event, origin?: Point) {
    const g = this.g,
      epoch = g.epoch,
      alive = () => g.epoch === epoch && g.mode === "play";
    g.hardLock = true;
    g.notice?.destroy();
    g.notice = undefined;
    const center = { x: 270, y: g.H * 0.42 };
    const key =
      e.reward === "move"
        ? "ui.move"
        : e.reward === "bomb"
          ? "effects.firecracker"
          : e.positive
            ? `ui.${e.reward}`
            : "f.play.backBlue";
    // The board stays lit. Native box and additive light must remain separate.
    const overlay = g.add.container().setDepth(112).setName("gift-reward");
    this.stage = "opening";
    if (!e.actor) {
      g.sfx("gift");
      const box = this.spawn("giftOpen", center, 460, 110);
      const glow = this.spawn("giftGlow", center, 460, 109)
        .setBlendMode(Phaser.BlendModes.ADD);
      for (const sprite of [box, glow])
        sprite.once("animationcomplete", () => sprite.destroy());
      box.play("native.giftOpen");
      glow.play("native.giftGlow");
      // Reveal on the lid opening, not after an empty box has sat on screen.
      await g.sleep(1580);
      if (!alive()) return;
    } else {
      if (origin) {
        await this.fly(key, origin, center, 60, 330);
        if (!alive()) return;
      }
    }
    this.stage = "reveal";
    this.rewardLight(overlay, center, !!e.positive);
    const rays = g.add
      .image(center.x, center.y, "reward.et_shine_101")
      .setDisplaySize(420, 420)
      .setTint(e.positive ? 0xffd15d : 0xa9bde1)
      .setBlendMode(Phaser.BlendModes.NORMAL)
      .setAlpha(0);
    overlay.add(rays);
    g.tweens.add({ targets: rays, alpha: 0.65, angle: 22, duration: 420, ease: "Cubic.Out" });
    const reward = g.add.container(center.x, center.y);
    overlay.add(reward);
    g.fit(reward, 0, 0, "reward.play_btn_0001", 142, 142);
    g.fit(reward, 0, -3, key, 94, 100);
    if (!e.positive) g.fit(reward, 0, -3, "f.play.backPattern", 94, 100);
    const amount =
      e.amount ||
      Math.max(1, (e.rewardCountAfter || 0) - (e.rewardCountBefore || 0));
    if (e.positive && e.rewardCountAfter !== undefined) {
      g.fit(reward, 56, -46, "reward.maincollect_pic_redpoint", 48, 38);
      g.txt(reward, 56, -46, `+${amount}`, 23, "#fff3cd");
    }
    const title = e.positive ? (e.actor ? "幸运奖励" : "获得奖励") : "小小迷雾";
    g.txt(overlay, center.x, center.y - 118, title, 29, "#ffe6a0").setStroke(
      "#674219",
      3,
    );
    g.txt(
      overlay,
      center.x,
      center.y + 112,
      e.text || names[e.reward || ""] || "",
      23,
      "#fff0c6",
    ).setStroke("#674219", 4);
    if (!e.positive)
      g.txt(
        overlay,
        center.x,
        center.y + 145,
        "点一下即可永久翻开",
        17,
        "#d6d9cf",
      );
    reward.setScale(0.5);
    await g.tween(reward, { scale: 1, duration: 260, ease: "Back.Out" });
    if (!alive()) return;
    this.stars(center, 18, e.positive ? 0xffd36d : 0xc7d0e5);
    await g.sleep(e.actor ? 320 : 520);
    if (!alive()) return;
    this.stage = "flight";
    reward.setVisible(false);
    g.tweens.add({
      targets: overlay,
      alpha: 0,
      duration: 320,
      onComplete: () => overlay.destroy(),
    });
    if (e.positive) {
      const to =
        e.reward === "move"
          ? g.stashPoint()
          : g.controls[e.reward || ""] || { x: 215, y: g.trayY() };
      await this.fly(key, center, to, 88, 600);
      if (!alive()) return;
      this.stage = "arrival";
      if (
        e.rewardCountAfter !== undefined &&
        e.reward &&
        e.reward in g.visualInventory
      )
        g.visualInventory[e.reward as Tool] = e.rewardCountAfter;
      g.renderHud();
      const target = g.toolViews.get(e.reward as Tool);
      if (target)
        g.tweens.add({
          targets: target,
          scale: 1.16,
          duration: 115,
          yoyo: true,
          ease: "Sine.Out",
        });
      this.stars(to, 20);
      g.sfx("button");
      const stamp = g.add.container(to.x, to.y - 63).setDepth(130);
      g.txt(
        stamp,
        0,
        0,
        e.rewardCountAfter !== undefined ? `+${amount}` : "已激活",
        28,
        "#ffe6a1",
      ).setStroke("#77420f", 3);
      g.tweens.add({
        targets: stamp,
        y: stamp.y - 28,
        alpha: 0,
        delay: 200,
        duration: 600,
        onComplete: () => stamp.destroy(),
      });
    } else {
      await Promise.all(
        (e.ids || []).map(async (id) => {
          const to = g.boardPoints.get(id);
          if (to) await this.fly("f.play.backBlue", center, to, 40, 420);
        }),
      );
      if (!alive()) return;
      g.renderBoard();
    }
    if (alive()) {
      this.stage = "idle";
      g.hardLock = false;
    }
  }
  /** Original APK light textures: short bright core, rising shafts, long soft tail. */
  private rewardLight(layer: Phaser.GameObjects.Container, p: Point, positive: boolean) {
    const g = this.g, gold = positive ? 0xffce68 : 0xbbcce8;
    const halo = g.add.image(p.x, p.y, "reward.et_glow_001")
      .setDisplaySize(110, 110).setTint(gold).setAlpha(0)
      .setBlendMode(Phaser.BlendModes.ADD);
    layer.add(halo);
    g.tweens.add({ targets: halo, displayWidth: 380, displayHeight: 300, alpha: 0.8,
      duration: 180, ease: "Cubic.Out", onComplete: () => {
        if (halo.active) g.tweens.add({ targets: halo, alpha: 0.24, duration: 650 });
      } });
    for (let i = 0; i < 3; i++) {
      const beam = g.add.image(p.x, p.y + 24, "reward.et_reward_light_01")
        .setOrigin(0.5, 0).setAngle(180 + (i - 1) * 24)
        .setDisplaySize(90, 45).setTint(gold).setAlpha(0)
        .setBlendMode(Phaser.BlendModes.NORMAL);
      layer.add(beam);
      g.tweens.add({ targets: beam, displayHeight: 250 + (i % 2) * 40,
        displayWidth: 125, alpha: 0.65, duration: 220, delay: i * 28,
        ease: "Cubic.Out", onComplete: () => {
          if (beam.active) g.tweens.add({ targets: beam, alpha: 0, duration: 520 });
        } });
    }
    const glint = g.add.image(p.x, p.y, "reward.et_star_003")
      .setDisplaySize(260, 30).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    layer.add(glint);
    g.tweens.add({ targets: glint, alpha: 0.9, displayWidth: 430,
      duration: 120, yoyo: true, hold: 50, onComplete: () => glint.destroy() });
    for (let i = 0; i < 14; i++) {
      const angle = i * Math.PI * 2 / 14;
      const star = g.add.image(p.x, p.y, "reward.et_star_003")
        .setDisplaySize(i % 3 === 0 ? 20 : 10, i % 3 === 0 ? 20 : 10)
        .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      layer.add(star);
      g.tweens.add({ targets: star, x: p.x + Math.cos(angle) * (110 + i % 3 * 22),
        y: p.y + Math.sin(angle) * 100 - 35, alpha: 1, angle: 45,
        delay: i * 12, duration: 250, ease: "Cubic.Out", onComplete: () => {
          if (star.active) g.tweens.add({ targets: star, y: star.y - 24,
            alpha: 0, duration: 500 });
        } });
    }
  }
  async bomb(e: Event, origin?: Point) {
    const g = this.g;
    if (!e.ids?.length) {
      if (e.text) g.toast(e.text, 1500);
      return;
    }
    const from = origin || { x: 215, y: g.trayY() };
    for (let i = 0; i < e.ids.length; i += 2) {
      const pair = {
        ids: e.ids.slice(i, i + 2),
        from,
        dragon: e.actor === "dragon",
        started: false,
      };
      for (const id of pair.ids) this.blasts.set(id, pair);
    }
    this.stars(from, 8);
    g.sfx("firecrackerFly");
    await g.sleep(100);
  }
  async collectBlast(id: number) {
    const blast = this.blasts.get(id);
    if (!blast) return;
    this.blasts.delete(id);
    if (blast.started) return;
    blast.started = true;
    const g = this.g,
      epoch = g.epoch,
      to = g.boardPoints.get(id);
    if (!to) return;
    const targets = blast.ids
      .map((id) => g.boardPoints.get(id))
      .filter((p): p is Point => !!p);
    await Promise.all(
      targets.map((p) =>
        blast.dragon
          ? this.breath(blast.from, p)
          : this.fly("effects.firecracker", blast.from, p, 45, 220),
      ),
    );
    if (epoch !== g.epoch) return;
    g.sfx("explosion");
    for (const p of targets)
      void this.play("bomb", p, Math.max(125, g.boardW * 1.8), 115);
    await g.sleep(180);
  }
  async breath(from: Point, to: Point) {
    const g = this.g;
    for (let i = 0; i < 12; i++) {
      const ember = g.add
        .image(from.x, from.y, "reward.et_fire_002", `ember${i % 16}`)
        .setDisplaySize(38, 38)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(118);
      g.tweens.add({
        targets: ember,
        x: to.x + (Math.random() - 0.5) * 24,
        y: to.y + (Math.random() - 0.5) * 24,
        alpha: 0.25,
        angle: Math.random() * 70,
        duration: 240,
        delay: i * 11,
        ease: "Cubic.In",
        onComplete: () => ember.destroy(),
      });
    }
    await g.sleep(330);
  }
}
