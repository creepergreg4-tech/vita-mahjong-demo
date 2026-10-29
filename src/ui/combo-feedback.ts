import Phaser from "phaser";
import type { FidelityScene } from "../scenes/FidelityScene";

const names = ["good1", "great1", "excellent", "amazing1", "unbelievable"];
const voices = ["good", "great", "excellent", "amazing", "unbelievable"];
const colors = ["green", "blue", "purple", "yellow", "multicolor"];

/** Highest tray tier persists for this round, independently of the current chain. */
export class ComboFeedback {
  frame?: Phaser.GameObjects.Image;
  tier = 0;
  lastLabel = "";
  private praise?: Phaser.GameObjects.Container;
  constructor(private scene: FidelityScene) {}
  draw(parent: Phaser.GameObjects.Container) {
    const g = this.scene;
    this.tier = Math.min(5, Math.floor(g.p.s.bestCombo / 5));
    const key = this.tier
      ? `f.combo.tile_bg_holder4_${colors[this.tier - 1]}`
      : "f.play.tray4";
    this.frame = g.img(parent, 215, g.trayY(), key, 268, 91);
  }
  match(combo: number, best: number, clever = false) {
    const g = this.scene,
      tier = Math.min(5, Math.floor(best / 5));
    this.tier = tier;
    if (this.frame?.active) {
      this.frame
        .setTexture(
          tier ? `f.combo.tile_bg_holder4_${colors[tier - 1]}` : "f.play.tray4",
        )
        .setDisplaySize(268, 91);
      g.tweens.killTweensOf(this.frame);
      const sx = this.frame.scaleX,
        sy = this.frame.scaleY;
      g.tweens.add({
        targets: this.frame,
        scaleX: sx * 1.035,
        scaleY: sy * 1.07,
        duration: 95,
        yoyo: true,
        ease: "Sine.Out",
      });
    }
    const glow = g.add
      .image(215, g.trayY(), "f.combo.tile_bg_holder4_glow")
      .setDisplaySize(277, 98)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(61)
      .setAlpha(0.75);
    g.tweens.add({
      targets: glow,
      alpha: 0,
      duration: 420,
      onComplete: () => glow.destroy(),
    });
    const note = `mahjong_sort_combo${Math.min(6, Math.max(1, combo))}`;
    this.audio(note, 0.36);
    if (combo > 0 && combo % 5 === 0) {
      const index = Math.min(4, Math.floor(combo / 5) - 1);
      this.label(`play_pic_combo_${names[index]}`, combo);
      this.audio(`mahjong_combo_${voices[index]}_test2`, 0.65);
      for (let i = 0; i < 15; i++) {
        const flower = g.add
          .image(215, g.trayY(), `f.combo.play_pic_combo_flower${(i % 2) + 1}`)
          .setDisplaySize(8 + (i % 4), 10 + (i % 4))
          .setDepth(94)
          .setTint(i % 3 ? 0xffd779 : 0xffe6dc);
        g.tweens.add({
          targets: flower,
          x: 95 + Math.random() * 250,
          y: g.trayY() + 80 + Math.random() * 150,
          angle: Math.random() * 400,
          alpha: 0,
          duration: 900 + Math.random() * 500,
          onComplete: () => flower.destroy(),
        });
      }
    } else if (clever) this.label("play_pic_combo_smartmove");
    else if (combo === 3 || combo % 5 === 3)
      this.label("play_tile_encourage_perfect");
  }
  label(key: string, count?: number) {
    const g = this.scene;
    if (
      g.coach?.phase ||
      (g.p.s.slotOpen && !g.saveData.tutorials.includes("stash-flow-v1"))
    )
      return;
    this.praise?.destroy();
    this.lastLabel = key;
    const c = g.add.container(215, g.trayY() + 69).setDepth(140);
    this.praise = c;
    const w = count ? (key.includes("unbelievable") ? 270 : 220) : 195;
    g.fit(c, 0, 0, `f.combo.${key}`, w, count ? 46 : 34);
    if (count)
      g.txt(c, 0, 34, `Combo ×${count}`, 18, "#ffdf86").setStroke("#5c421b", 3);
    c.setScale(0.65).setAlpha(0.3);
    g.tweens.add({
      targets: c,
      scale: 1,
      alpha: 1,
      duration: 170,
      ease: "Back.Out",
    });
    g.tweens.add({
      targets: c,
      y: c.y - 6,
      alpha: 0,
      delay: 1000,
      duration: 250,
      onComplete: () => c.destroy(),
    });
  }
  audio(key: string, volume: number) {
    const g = this.scene;
    if (g.saveData.sound && g.cache.audio.exists(`combo.${key}`))
      g.sound.play(`combo.${key}`, { volume });
  }
  destroy() {
    this.praise?.destroy();
  }
  isPresent() {
    return !!this.praise?.active;
  }
}
