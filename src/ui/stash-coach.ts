import type Phaser from "phaser";
import type { FidelityScene } from "../scenes/FidelityScene";
import { canStash, clone, free, onBoard, same } from "../core/model";
import { solve } from "../core/solver";

/** One complete, non-blocking lesson. Unlocking alone never completes it. */
export class StashCoach {
  phase = "";
  target: number | null = null;
  private signature = "";
  private reserved: number | null = null;
  private layer?: Phaser.GameObjects.Container;
  constructor(private scene: FidelityScene) {}
  destroy() {
    if (this.layer) {
      this.scene.tweens.killTweensOf(this.layer.getAll());
      this.layer.destroy();
      this.layer = undefined;
    }
  }
  refresh() {
    const g = this.scene;
    if (
      g.mode !== "play" ||
      !g.p ||
      g.saveData.tutorials.includes("stash-flow-v1")
    ) {
      this.destroy();
      this.phase = "";
      return;
    }
    const s = g.p.s;
    if (s.slotPending !== null) this.reserved = s.slotPending;
    const signature = [
      g.pending,
      !!g.modal,
      !!g.dmElement,
      g.transition,
      g.p.stashMode,
      s.moves,
      s.slot,
      s.slotPending,
      s.slotOpen,
      s.bonus?.status,
      s.tray.join(","),
      s.tiles.filter((t) => t.removed).length,
    ].join("/");
    if (signature === this.signature) return;
    this.signature = signature;
    this.destroy();
    this.phase = "";
    this.target = null;
    if (
      g.pending ||
      g.modal ||
      g.dmElement ||
      g.transition ||
      s.bonus?.status === "active"
    )
      return;
    if (
      this.reserved !== null &&
      !s.slotOpen &&
      s.tiles.find((t) => t.id === this.reserved)?.removed
    ) {
      g.learn("stash-flow-v1");
      g.learn("move");
      g.toast(
        s.stashCharges
          ? "配对完成，暂存格已上锁 · 点空位使用储备机会"
          : "配对完成，暂存格已上锁 · 再配对移位牌可解锁",
        3200,
      );
      return;
    }
    if (!s.slotOpen) return;
    let point = g.stashPoint(),
      message = "① 点这里，启用暂存",
      phase = "activate";
    if (s.slot !== null) {
      phase = "return";
      message =
        s.tray.length < 4
          ? "③ 点暂存牌，取回上方四格"
          : "先清理四格，再点暂存牌取回";
    } else if (s.slotPending !== null) {
      phase = "match";
      const stored = s.tiles.find((t) => t.id === s.slotPending)!;
      const mate = s.tiles.find(
        (t) => free(s, t) && !t.hidden && same(t, stored),
      );
      if (mate) {
        this.target = mate.id;
        point = g.currentPoint(mate.id);
      }
      message = mate
        ? "④ 点同样的牌配对，暂存格会重新上锁"
        : "④ 配对刚取回的牌后，暂存格重新上锁";
      if (!mate) {
        const next = solve(s, 12000, 20)?.[0];
        if (next?.type === "collect") {
          const t = s.tiles.find((t) => t.id === next.a);
          if (t && free(s, t)) {
            this.target = t.id;
            point = g.currentPoint(t.id);
            message = "先移开这张牌，为暂存牌的配对让路";
          }
        }
      }
    } else if (g.p.stashMode) {
      phase = "choose";
      // Prefer an immediate teachable cycle, including a genuinely side-blocked tile.
      const candidates = s.tiles.filter((t) => canStash(s, t));
      const ranked = candidates
        .map((t) => {
          const preview = clone(s);
          preview.slot = t.id;
          preview.slotPending = t.id;
          preview.tray = preview.tray.filter((id) => id !== t.id);
          const mate = preview.tiles.some(
            (o) => free(preview, o) && !o.hidden && same(o, t),
          );
          return {
            t,
            score: (mate ? 10 : 0) + (onBoard(s, t) && !free(s, t) ? 2 : 0),
          };
        })
        .sort((a, b) => b.score - a.score);
      const t = ranked[0]?.t;
      if (t) {
        this.target = t.id;
        point = g.currentPoint(t.id);
      }
      message = t
        ? "② 点这张表面普通牌，移入暂存"
        : "暂无可暂存的普通牌 · 再点空格取消";
    }
    this.phase = phase;
    // Replace the transient instruction, so two captions never overlap.
    g.notice?.destroy();
    g.notice = undefined;
    const c = g.add.container().setDepth(150);
    this.layer = c;
    const y = g.H * 0.205;
    c.add(
      g.add
        .graphics()
        .fillStyle(0x153b2b, 0.94)
        .fillRoundedRect(20, y - 19, 500, 38, 12)
        .lineStyle(1, 0xc5a25c, 0.8)
        .strokeRoundedRect(20, y - 19, 500, 38, 12),
    );
    g.txt(c, 270, y, message, 18, "#ffebae");
    if ((phase === "match" || phase === "choose") && this.target === null)
      return;
    if (phase === "return" && s.tray.length >= 4) return;
    const ring = g.add
      .circle(point.x, point.y, 25)
      .setStrokeStyle(3, 0xffe39a)
      .setFillStyle(0, 0);
    c.add(ring);
    g.tweens.add({
      targets: ring,
      scale: 1.4,
      alpha: 0.2,
      duration: 750,
      repeat: -1,
    });
    // The hand is the APK's common_hand sprite; its fingertip is at the upper left.
    const hand = g.add
      .image(point.x + 4, point.y + 4, "f.play.guideHand")
      .setDisplaySize(62, 90)
      .setOrigin(0.1, 0.055);
    c.add(hand);
    if (phase === "choose" && this.target !== null) {
      const from = g.stashPoint();
      hand.setPosition(from.x + 4, from.y + 4);
      g.tweens.add({
        targets: hand,
        x: point.x + 4,
        y: point.y + 4,
        duration: 650,
        ease: "Sine.InOut",
      });
    }
    g.tweens.add({
      targets: hand,
      scaleX: hand.scaleX * 0.9,
      scaleY: hand.scaleY * 0.9,
      duration: 420,
      yoyo: true,
      repeat: -1,
      delay: 650,
    });
  }
}
