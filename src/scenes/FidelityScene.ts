import Phaser from "phaser";
import type { AppData } from "../main";
import { Puzzle } from "../core/rules";
import {
  type Tile,
  type Event,
  type Tool,
  clone,
  live,
  onBoard,
  free,
  exposed,
  canStash,
  isQueued,
  queueDepth,
  type State,
} from "../core/model";
import { solve } from "../core/solver";
import { readSave, writeSave, type Save } from "../ui/storage";
import { StashCoach } from "../ui/stash-coach";
import { openLevelDM, closeLevelDM } from "../ui/dm";
import { BoardMotionView } from "../ui/board-motion";
import { ComboFeedback } from "../ui/combo-feedback";
import { TimedMechanics } from "../ui/timed-mechanics";
import { NativeEffects } from "../ui/native-effects";
import { ExperimentView } from "../ui/experiment-view";
import { LineModeView } from "../ui/line-mode";

type C = Phaser.GameObjects.Container;
type Point = { x: number; y: number };
const W = 540;
const FACE_KEYS = [
  "faces.dot2",
  "faces.green",
  "faces.character2",
  "faces.bamboo2",
  "f.faces.dog_11",
  "faces.north",
  "faces.dot8",
  "f.faces.snack_11",
  "faces.bamboo6",
  "f.faces.retro_1",
  "f.faces.dog_6",
  "faces.character4",
  "faces.dot3",
  "faces.red",
  "faces.bamboo3",
  "faces.dot9",
  "faces.east",
  "faces.bamboo9",
  "faces.character5",
  "faces.dot6",
  "f.faces.animal_5",
  "faces.bamboo8",
  "faces.south",
  "faces.dot1",
  "faces.character6",
  "f.faces.extra_flower_3",
  "faces.bamboo4",
  "faces.west",
  "faces.dot5",
  "faces.character1",
  "faces.bamboo5",
  "faces.dot4",
  "faces.character3",
  "faces.white",
  "faces.bamboo1",
  "faces.character7",
  "faces.character8",
  "faces.character9",
  "faces.bamboo7",
  "faces.dot7",
  "f.faces.snack_1",
  "f.faces.retroV2_9",
];
export class FidelityScene extends Phaser.Scene {
  app!: AppData;
  H = 1200;
  mode: "home" | "play" | "result" = "home";
  saveData: Save = readSave();
  p!: Puzzle;
  root!: C;
  board!: C;
  hud!: C;
  trayLayer!: C;
  modal?: C;
  notice?: C;
  extra?: C;
  tileViews = new Map<number, C>();
  boardPoints = new Map<number, Point>();
  trayViews = new Map<number, C>();
  visualTray: number[] = [];
  pending = 0;
  chain: Promise<void> = Promise.resolve();
  transition = false;
  epoch = 0;
  hardLock = false;
  motionPending = false;
  boardW = 80;
  boardH = 98;
  controls: Record<string, Point> = {};
  started = 0;
  paused: number | null = null;
  elapsed = 0;
  iqView?: C;
  hintIds: number[] = [];
  test = false;
  failedAssets: string[] = [];
  fullNotified = false;
  lastBlockedNotice = 0;
  blockedSoundPlayed = false;
  dmElement?: HTMLDivElement;
  coach?: StashCoach;
  motionView?: BoardMotionView;
  comboFx?: ComboFeedback;
  timed?: TimedMechanics;
  nativeFx?: NativeEffects;
  visualInventory: Record<Tool, number> = {
    shuffle: 2,
    magnet: 2,
    hint: 3,
    undo: 4,
  };
  visualBonusIQ = 0;
  toolViews = new Map<Tool, C>();
  experimentView?: ExperimentView;
  flowDirection = 1;
  lineMode?: LineModeView;
  helper?: Phaser.GameObjects.Text;
  particles: {
    image: Phaser.GameObjects.Image;
    vx: number;
    vy: number;
    spin: number;
    age: number;
    life: number;
  }[] = [];
  constructor() {
    super("fidelity");
  }
  preload() {
    this.app = this.registry.get("app");
    this.H = this.app.height;
    const status = document.getElementById("loading");
    this.load.on("loaderror", (file: Phaser.Loader.File) => this.failedAssets.push(file.key));
    for (const [key, url] of Object.entries(this.app.manifest.faces))
      this.load.image(`faces.${key}`, url);
    const uiKeys = new Set([
      "button",
      "shuffle",
      "magnet",
      "hint",
      "undo",
      "lock",
      "move",
      "gift",
      "homeLogo",
      "resultLotus",
      "resultOrnament",
    ]);
    for (const [key, url] of Object.entries(this.app.manifest.ui))
      if (uiKeys.has(key)) this.load.image(`ui.${key}`, url);
    for (const [key, url] of Object.entries(this.app.manifest.effects))
      if (["giftBody", "giftLid", "giftGlow", "firecracker"].includes(key))
        this.load.image(`effects.${key}`, url);
    for (const [key, url] of Object.entries(this.app.manifest.audio))
      this.load.audio(`audio.${key}`, url);
    const selected: Record<string, string[]> = {
      home: [
        "idleNative",
        "logo",
        "startButton",
        "profile",
        "profileFrame",
        "leafCounterBackground",
        "leaf",
        "ranksButton",
        "settingsButton",
      ],
      play: [
        "guideHand",
        "background",
        "tilePlainBlue",
        "backBlue",
        "backPattern",
        "tileShadow",
        "tray4",
        "iqLabel",
        "backButton",
        "menuButton",
        "dialogPanel",
        "dialogHeader",
        "greenButton",
        "beigeButton",
        "closeButton",
      ],
      rank: [
        "panel",
        "first",
        "second",
        "third",
        "firstPodium",
        "secondPodium",
        "thirdPodium",
        "card",
      ],
      effects: ["whiteShards", "magnetLarge"],
    };
    for (const group of ["home", "play", "rank", "effects", "glyphs"])
      for (const [key, url] of Object.entries(this.app.fidelity[group] || {}))
        if (
          typeof url === "string" &&
          (group === "glyphs" || selected[group]?.includes(key))
        )
          this.load.image(`f.${group}.${key}`, url);
    for (const key of FACE_KEYS.filter((k) => k.startsWith("f."))) {
      const name = key.slice(8),
        url = this.app.fidelity.faces[name];
      if (url) this.load.image(key, url);
    }
    for (const [key, url] of Object.entries(this.app.fidelity.combo || {})) {
      if (typeof url !== "string") continue;
      if (
        /^(mahjong_sort_combo[1-6]|mahjong_combo_(good|great|excellent|amazing|unbelievable)_test2)$/.test(
          key,
        )
      )
        this.load.audio(`combo.${key}`, url);
      else if (
        /^(tile_bg_holder4_|play_pic_combo_|play_tile_encourage_perfect$)/.test(
          key,
        )
      )
        this.load.image(`f.combo.${key}`, url);
    }
    const rewardKeys = new Set([
      "et_shine_101",
      "et_reward_light_01",
      "et_star_002",
      "et_star_003",
      "et_glow_001",
      "et_glow_003",
      "et_trail_032",
      "maincollect_pic_redpoint",
      "play_btn_0001",
      "common_icon_0002",
      "common_icon_0006",
      "common_icon_0007",
      "et_fire_002",
    ]);
    for (const [key, url] of Object.entries(this.app.fidelity.rewardFx || {}))
      if (rewardKeys.has(key)) this.load.image(`reward.${key}`, url);
    this.load.image(
      "experiment.dragon",
      "assets/experiments/festival-dragon.png",
    );
    NativeEffects.preload(this, this.app.nativeClips);
    this.load.on("progress", (v: number) => {
      if (status)
        status.innerHTML = `Vita Mahjong<small>准备牌桌 ${Math.round(v * 100)}%</small>`;
    });
  }
  create() {
    if (this.failedAssets.length) {
      const loading = document.getElementById("loading");
      if (loading) {
        loading.textContent = "素材未加载完整，点此重新加载";
        loading.onclick = () => location.reload();
      }
      return;
    }
    document.getElementById("loading")?.remove();
    this.test = new URLSearchParams(location.search).has("test");
    this.makeShardFrames();
    this.home();
    (window as any).render_game_to_text = () =>
      JSON.stringify(this.stateText());
    if (this.test)
      (window as any).__test = {
        start: (n: number) => this.play(n),
        solve: () => solve(this.p.s, 200000),
        tap: (id: number) => this.tap(id),
        tool: (t: Tool) => this.tool(t),
        stash: () => this.stash(),
        state: () => this.stateText(),
        gift: (seed: number) => {
          this.p.s.seed = seed;
          this.p.save();
          this.dispatch(this.p.gift());
        },
        fixture: (s: any) => {
          this.p.s = s;
          this.visualInventory = clone(s.inventory);
          this.visualTray = [...s.tray];
          this.renderAll();
        },
      };
    const n = Number(new URLSearchParams(location.search).get("level"));
    if (this.test && n >= 1 && n <= this.app.levels.length) this.play(n);
    else if (!this.test) this.openingQuote();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.mode === "play") {
        this.persist();
        if (this.paused === null) this.paused = Date.now();
      } else if (!this.modal && !this.dmElement && this.paused !== null) {
        this.started += Date.now() - this.paused;
        this.paused = null;
      }
    });
    window.addEventListener("pagehide", () => this.persist());
  }
  update(_time: number, dt: number) {
    this.coach?.refresh();
    this.lineMode?.refresh();
    (
      this.board?.getByName("motionCaption") as Phaser.GameObjects.Text | null
    )?.setVisible(
      !this.notice?.active &&
        !this.coach?.phase &&
        !this.lineMode?.phase &&
        !this.lineMode?.announcing,
    );
    this.timed?.update(dt);
    const d = Math.min(0.05, dt / 1000);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += d;
      p.vy += 610 * d;
      p.image.x += p.vx * d;
      p.image.y += p.vy * d;
      p.image.angle += p.spin * d;
      p.image.setAlpha(Math.min(1, (p.life - p.age) * 2.4));
      if (p.age >= p.life) {
        p.image.destroy();
        this.particles.splice(i, 1);
      }
    }
  }
  stateText() {
    return {
      mode: this.mode,
      level: this.p?.level.id ?? null,
      busy: this.pending > 0 || this.transition,
      modal: !!this.modal || !!this.dmElement,
      guide: {
        phase: this.coach?.phase || "",
        target: this.coach?.target ?? null,
      },
      blockedSoundPlayed: this.blockedSoundPlayed,
      visualInventory: this.visualInventory,
      visualBonusIQ: this.visualBonusIQ,
      rewardStage: this.nativeFx?.stage || "idle",
      lineProgress: this.lineMode?.visibleCleared ?? null,
      lineGuide: this.lineMode?.phase || "",
      experimentResult: this.experimentView?.lastResult || "",
      comboFeedback: {
        tier: this.comboFx?.tier || 0,
        label: this.comboFx?.lastLabel || "",
      },
      beltElapsedMs: this.timed?.beltElapsed || 0,
      canvas: { width: W, height: this.H },
      controls: this.controls,
      seconds: this.mode === "play" ? this.seconds() : this.elapsed,
      ...(this.p && this.mode !== "home"
        ? {
            state: this.p.s,
            stashMode: this.p.stashMode,
            tiles: live(this.p.s).map((t) => ({
              ...t,
              free: free(this.p.s, t),
              exposed: exposed(this.p.s, t),
              queued: isQueued(this.p.s, t),
              queueDepth: queueDepth(this.p.s, t),
              location: this.p.s.tray.includes(t.id)
                ? "tray"
                : this.p.s.slot === t.id
                  ? "stash"
                  : "board",
              screen: this.currentPoint(t.id),
            })),
            visualTray: this.visualTray,
            hint: this.hintIds,
          }
        : {}),
    };
  }
  txt(
    parent: C,
    x: number,
    y: number,
    text: string,
    size = 24,
    color = "#fff0cb",
  ) {
    const t = this.add
      .text(x, y, text, {
        fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif',
        fontSize: size,
        color,
        align: "center",
        lineSpacing: 4,
      })
      .setOrigin(0.5);
    parent.add(t);
    return t;
  }
  img(parent: C, x: number, y: number, key: string, w: number, h: number) {
    const im = this.add.image(x, y, key).setDisplaySize(w, h);
    parent.add(im);
    return im;
  }
  fit(parent: C, x: number, y: number, key: string, w: number, h: number) {
    const src = this.textures.get(key).getSourceImage() as HTMLImageElement;
    const k = Math.min(w / src.width, h / src.height);
    return this.img(parent, x, y, key, src.width * k, src.height * k);
  }
  hit(
    parent: C,
    x: number,
    y: number,
    w: number,
    h: number,
    action: () => void,
  ) {
    const z = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });
    const epoch = this.epoch;
    parent.add(z);
    z.on("pointerup", () => {
      if (
        this.epoch === epoch &&
        z.active &&
        !this.dmElement &&
        !this.transition
      )
        action();
    });
    return z;
  }
  nativeButton(
    parent: C,
    x: number,
    y: number,
    key: string,
    size: number,
    action: () => void,
  ) {
    const c = this.add.container(x, y);
    parent.add(c);
    this.fit(c, 0, 0, key, size, size);
    const z = this.hit(c, 0, 0, size + 8, size + 8, () => {
      c.setScale(1);
      this.sfx("button");
      action();
    });
    z.on("pointerdown", () => c.setScale(0.95));
    z.on("pointerout", () => c.setScale(1));
    return c;
  }
  orange(
    parent: C,
    x: number,
    y: number,
    w: number,
    label: string,
    action: () => void,
  ) {
    const c = this.add.container(x, y);
    parent.add(c);
    this.img(c, 0, 0, "f.home.startButton", w, (w * 222) / 726);
    this.txt(c, 0, -2, label, 31, "#fff3cf").setShadow(1, 2, "#8a3700", 2);
    this.hit(c, 0, 0, w, w * 0.31, () => {
      this.sfx("button");
      action();
    });
    return c;
  }
  reset() {
    this.lineMode?.clearGuide();
    this.lineMode = undefined;
    this.comboFx?.destroy();
    this.comboFx = undefined;
    this.motionView = undefined;
    this.timed = undefined;
    this.nativeFx = undefined;
    this.toolViews.clear();
    this.experimentView = undefined;
    this.flowDirection = 1;
    this.coach?.destroy();
    this.coach = undefined;
    closeLevelDM(this);
    this.epoch++;
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.children.removeAll(true);
    this.root = this.add.container();
    this.board = this.add.container();
    this.hud = this.add.container();
    this.trayLayer = this.add.container();
    this.root.add([this.board, this.hud, this.trayLayer]);
    this.modal = undefined;
    this.notice = undefined;
    this.particles = [];
    this.tileViews.clear();
    this.trayViews.clear();
    this.boardPoints.clear();
    this.visualTray = [];
    this.pending = 0;
    this.chain = Promise.resolve();
    this.hardLock = false;
    this.motionPending = false;
    this.transition = false;
    this.controls = {};
    this.paused = null;
  }
  backdrop() {
    const bg = this.img(
      this.root,
      W / 2,
      this.H / 2,
      "f.play.background",
      W,
      this.H,
    );
    this.root.sendToBack(bg);
  }
  home() {
    this.mode = "home";
    this.reset();
    const back = this.img(
      this.root,
      W / 2,
      this.H / 2,
      "f.home.idleNative",
      W,
      (this.textures.get("f.home.idleNative").getSourceImage().height * W) /
        1082,
    );
    this.root.sendToBack(back);
    this.fit(this.root, 270, this.H * 0.205, "f.home.logo", 405, 178);
    this.fit(this.root, 58, 75, "f.home.profileFrame", 86, 94);
    this.fit(this.root, 58, 75, "f.home.profile", 70, 70);
    this.hit(this.root, 58, 75, 90, 96, () => this.levels());
    this.fit(this.root, 171, 62, "f.home.leafCounterBackground", 125, 47);
    this.fit(this.root, 137, 61, "f.home.leaf", 29, 28);
    this.txt(
      this.root,
      184,
      60,
      `x${this.saveData.records.length}`,
      24,
      "#fff1bc",
    );
    this.nativeButton(this.root, 491, 65, "f.home.settingsButton", 48, () =>
      this.settings(),
    );
    this.nativeButton(this.root, 434, 65, "f.home.ranksButton", 48, () =>
      this.ranks(),
    );
    const current = this.saveData.current;
    const level = current?.level || this.saveData.unlocked;
    const y = this.H * 0.82;
    this.orange(this.root, 270, y, 365, `关卡 ${level}`, () =>
      this.enter(level, !!current),
    );
    this.controls.start = { x: 270, y };
    this.dmButton(this.root, 480, this.H * 0.925);
    this.time.addEvent({
      delay: 1800,
      loop: true,
      callback: () => {
        const leaf = this.fit(
          this.root,
          80 + Math.random() * 400,
          -20,
          "f.home.leaf",
          16 + Math.random() * 15,
          33,
        );
        leaf.setAlpha(0.65).setAngle(-30);
        this.tweens.add({
          targets: leaf,
          y: this.H + 40,
          x: leaf.x - 100,
          angle: 130,
          duration: 9000,
          onComplete: () => leaf.destroy(),
        });
      },
    });
  }
  openingQuote() {
    try {
      if (sessionStorage.getItem("vita-v2-opening")) return;
      sessionStorage.setItem("vita-v2-opening", "1");
    } catch {
      /* Private storage must not prevent play. */
    }
    const q = this.app.quotes[new Date().getDate() % this.app.quotes.length];
    if (!q) return;
    this.transition = true;
    const c = this.add.container().setDepth(400);
    this.img(c, 270, this.H / 2, "f.play.background", W, this.H);
    this.txt(
      c,
      270,
      this.H * 0.37,
      `“${q.text}”`,
      30,
      "#f2ecd9",
    ).setWordWrapWidth(430);
    this.txt(c, 432, this.H * 0.53, q.author, 20, "#d1d6bb").setOrigin(1, 0.5);
    this.fit(c, 270, this.H * 0.67, "ui.homeLogo", 190, 110);
    const bar = this.add
      .graphics()
      .fillStyle(0x328f62)
      .fillRoundedRect(72, this.H * 0.83, 396, 8, 4);
    c.add(bar);
    this.time.delayedCall(1100, () => {
      if (c.active) {
        c.destroy();
        this.transition = false;
      }
    });
  }
  async enter(n: number, resume = false) {
    if (this.transition) return;
    this.play(n, resume);
    this.transition = true;
    const cover = this.add.container().setDepth(300),
      source = this.textures
        .get("f.home.idleNative")
        .getSourceImage() as HTMLImageElement;
    const height = (source.height * W) / source.width;
    const left = this.img(
      cover,
      270,
      this.H / 2,
      "f.home.idleNative",
      W,
      height,
    ).setCrop(0, 0, source.width / 2, source.height);
    const right = this.img(
      cover,
      270,
      this.H / 2,
      "f.home.idleNative",
      W,
      height,
    ).setCrop(source.width / 2, 0, source.width / 2, source.height);
    this.tweens.add({
      targets: left,
      x: 270 - W * 0.63,
      duration: 720,
      ease: "Cubic.InOut",
    });
    this.tweens.add({
      targets: right,
      x: 270 + W * 0.63,
      duration: 720,
      ease: "Cubic.InOut",
    });
    this.sfx("button");
    await this.sleep(740);
    cover.destroy();
    this.transition = false;
  }
  play(n: number, resume = false) {
    this.mode = "play";
    this.reset();
    this.p = new Puzzle(this.app.levels[n - 1]);
    this.motionView = new BoardMotionView(this);
    this.comboFx = new ComboFeedback(this);
    this.timed = new TimedMechanics(this);
    this.nativeFx = new NativeEffects(this);
    this.nativeFx.initialize();
    this.experimentView = new ExperimentView(this);
    const saved = this.saveData.current;
    const restored = !!(resume && saved && this.p.restore(saved.puzzle));
    if (restored) this.timed.beltElapsed = saved?.beltElapsedMs || 0;
    if (this.p.s.movement?.type === "lines")
      this.lineMode = new LineModeView(this);
    this.visualInventory = clone(this.p.s.inventory);
    this.visualBonusIQ = this.p.s.bonusIQ || 0;
    this.blockedSoundPlayed = restored ? !!saved?.blockedSoundPlayed : false;
    this.lastBlockedNotice = 0;
    this.coach = new StashCoach(this);
    this.elapsed = restored ? saved!.seconds : 0;
    this.started = Date.now() - this.elapsed * 1000;
    this.visualTray = [...this.p.s.tray];
    this.hintIds = [];
    this.fullNotified = false;
    this.backdrop();
    this.renderAll();
    this.persist();
    if (this.p.full) this.time.delayedCall(200, () => this.fullTrayPanel());
    if (this.p.goalFailed)
      this.time.delayedCall(200, () => this.lineGoalPanel());
    if (n === 1 && !this.saveData.tutorials.includes("four-tray")) {
      const a = this.p.level.solution?.find((x) => x.type === "collect");
      if (a) this.hintIds = [a.a];
      this.toast("上方无遮挡、左右至少一侧空开，才能放入四格", 4700);
      this.renderBoard();
    } else if (n === 2 && !this.saveData.tutorials.includes("move"))
      this.toast("配对移位牌，可解锁右侧一次暂存", 3800);
    else if (n === 5 && !this.saveData.tutorials.includes("blue")) {
      this.toast("蓝背牌：露出后点一下翻面，再点一下放入四格", 4000);
      this.learn("blue");
    } else if (n === 7 && !this.saveData.tutorials.includes("bomb")) {
      this.toast("配对爆破牌，自动带走最多两对表面普通牌", 3500);
      this.learn("bomb");
    } else if (n === 13 && !this.saveData.tutorials.includes("gift")) {
      this.toast("首次礼盒固定赠送回退 +1；之后可能有小惊喜", 4000);
      this.learn("gift");
    }
    if (
      this.p.s.movement &&
      !this.saveData.tutorials.includes(this.p.s.movement.type)
    ) {
      const kind = this.p.s.movement.type;
      this.toast(
        kind === "lines"
          ? "整线实验 · 只取底牌，取走即下落；六张同牌清整线"
          : kind === "belt"
            ? "停稳后选牌 · 每 6 秒沿箭头传送一格"
            : kind === "ring"
              ? "配对成功后，外圈顺着箭头走一格 · 单张入槽不移动"
              : "每列只取最上方 · 取走一张，下方立即补位",
        4800,
      );
      this.learn(kind);
    }
    if (
      this.p.s.experiment &&
      !this.saveData.tutorials.includes(this.p.s.experiment.type)
    ) {
      const e = this.p.s.experiment;
      if (e.type === "slots")
        this.toast(
          `转轮：连续手动配对 ${e.threshold} 次自动触发，本关 ${e.maxActivations} 次`,
          4500,
        );
      this.learn(e.type);
    }
    if (
      this.p.s.movement?.type === "ring" &&
      this.p.s.movement.reversible &&
      !this.saveData.tutorials.includes("reverse-flow")
    ) {
      this.toast("回流棋局 · 普通牌顺转，特殊牌逆转", 4200);
      this.learn("reverse-flow");
    }
  }
  trayY() {
    return this.H * 0.1375;
  }
  trayPoint(i: number) {
    return { x: 119 + i * 64, y: this.trayY() - 1 };
  }
  stashPoint() {
    return { x: 421, y: this.trayY() };
  }
  seconds() {
    return Math.max(
      0,
      Math.floor(((this.paused ?? Date.now()) - this.started) / 1000),
    );
  }
  iq() {
    const progress =
      this.p.s.movement?.type === "lines"
        ? this.p.s.tiles.filter((t) => t.removed && !t.bonus).length / 2
        : this.p.s.matches;
    return (
      55.3 +
      progress * (30 / (this.p.level.tiles.length / 2)) +
      (this.p.s.bonusIQ || 0)
    );
  }
  persist() {
    if (this.mode === "play" && this.p && !this.p.won) {
      this.saveData.current = {
        level: this.p.level.id,
        seconds: this.seconds(),
        puzzle: this.p.export(),
        blockedSoundPlayed: this.blockedSoundPlayed,
        beltElapsedMs: this.timed?.beltElapsed || 0,
      };
      writeSave(this.saveData);
    }
  }
  learn(key: string) {
    if (!this.saveData.tutorials.includes(key)) {
      this.saveData.tutorials.push(key);
      writeSave(this.saveData);
    }
  }
  renderAll() {
    this.renderBoard();
    this.renderHud();
    this.layoutTray(this.visualTray);
  }
  renderHud() {
    this.hud.removeAll(true);
    this.toolViews.clear();
    this.nativeButton(
      this.hud,
      37,
      this.H * 0.075,
      "f.play.backButton",
      61,
      () => this.pause(),
    );
    this.nativeButton(
      this.hud,
      502,
      this.H * 0.075,
      "f.play.menuButton",
      61,
      () => this.pause(),
    );
    this.controls.menu = { x: 502, y: this.H * 0.075 };
    this.controls.back = { x: 37, y: this.H * 0.075 };
    this.drawIQ();
    this.comboFx?.draw(this.hud);
    if (this.p.s.movement?.type === "lines") {
      this.lineMode?.drawGoal();
      delete this.controls.slot;
    } else {
      const point = this.stashPoint();
      const g = this.add
        .graphics()
        .fillStyle(0x23170e, 0.88)
        .fillRoundedRect(point.x - 37, point.y - 45, 74, 90, 10)
        .lineStyle(2, this.p.s.slotOpen ? 0xe8c16b : 0x8b683e)
        .strokeRoundedRect(point.x - 37, point.y - 45, 74, 90, 10);
      this.hud.add(g);
      if (!this.p.s.slotOpen)
        this.fit(this.hud, point.x, point.y, "ui.lock", 30, 36);
      else if (this.p.s.slot !== null) {
        const t = this.p.s.tiles.find((t) => t.id === this.p.s.slot)!;
        const v = this.card(t, 64, 79);
        v.setName("stashCard");
        v.setPosition(point.x, point.y);
        this.hud.add(v);
        this.hintMark(v, t.id, 64, 79);
      } else if (this.p.s.slotPending !== null)
        this.txt(this.hud, point.x, point.y, "配对中", 14, "#baaa86");
      else
        this.txt(
          this.hud,
          point.x,
          point.y,
          this.p.stashMode ? "选牌" : "＋",
          this.p.stashMode ? 18 : 31,
          "#e6c67a",
        );
      this.txt(
        this.hud,
        point.x,
        point.y + 53,
        this.p.s.stashCharges ? `暂存 · 储备 ${this.p.s.stashCharges}` : "暂存",
        14,
        "#b2b995",
      );
      if (!this.p.s.slotOpen && this.p.s.stashCharges)
        this.txt(this.hud, point.x, point.y + 27, "点击启用", 12, "#ffe2a0");
      this.hit(this.hud, point.x, point.y, 80, 95, () => this.stash());
      this.controls.slot = point;
    }
    const tools: Tool[] = ["shuffle", "magnet", "hint", "undo"];
    tools.forEach((tool, i) => {
      const x = 117 + i * 103,
        y = this.H * 0.935;
      this.controls[tool] = { x, y };
      const c = this.add.container(x, y);
      this.toolViews.set(tool, c);
      this.hud.add(c);
      this.img(c, 0, 0, "ui.button", 85, 85);
      this.fit(c, 0, -1, `ui.${tool}`, 50, 50);
      this.hit(c, 0, 0, 88, 88, () => this.tool(tool));
      const count = this.visualInventory[tool];
      if (!count) c.setAlpha(0.45);
      const badge = this.add
        .graphics()
        .fillStyle(0xa93412)
        .fillRoundedRect(18, -47, 34, 31, 9)
        .lineStyle(2, 0xd69639)
        .strokeRoundedRect(18, -47, 34, 31, 9);
      c.add(badge);
      this.txt(c, 35, -31, String(count), 22, "#fff0c6");
    });
    this.txt(
      this.hud,
      this.p.s.experiment?.type === "dragon" ? 75 : W / 2,
      this.H * 0.875,
      this.p.level.id === 31 ? "实验 · 整线巧解" : `关卡 ${this.p.level.id}`,
      15,
      "#8eab8f",
    );
    this.dmButton(this.hud, 486, this.H * 0.875);
    this.timed?.draw();
    this.experimentView?.draw();
  }
  dmButton(parent: C, x: number, y: number) {
    this.fit(parent, x, y, "f.home.leafCounterBackground", 68, 36);
    this.txt(parent, x, y, "DM", 18, "#ffe5a3");
    this.hit(parent, x, y, 80, 46, () => openLevelDM(this));
    this.controls.dm = { x, y };
  }
  drawIQ() {
    if (this.iqView?.active) this.iqView.destroy();
    this.iqView = this.add.container(270, this.H * 0.075);
    this.hud.add(this.iqView);
    const str = (
      this.iq() -
      (this.p.s.bonusIQ || 0) +
      this.visualBonusIQ
    ).toFixed(1);
    const chars = [
      "iqLabel",
      ...str.split("").map((c) => (c === "." ? "period" : c)),
    ];
    const widths = chars.map((c) => {
      const source = this.textures
        .get(c === "iqLabel" ? "f.play.iqLabel" : `f.glyphs.${c}`)
        .getSourceImage() as HTMLImageElement;
      return (source.width / source.height) * 29;
    });
    let x = -widths.reduce((a, b) => a + b, 0) / 2 - 7;
    chars.forEach((c, i) => {
      this.fit(
        this.iqView!,
        x + widths[i] / 2,
        0,
        c === "iqLabel" ? "f.play.iqLabel" : `f.glyphs.${c}`,
        widths[i],
        31,
      );
      x += widths[i] + (i === 0 ? 9 : 1);
    });
    this.hit(this.iqView, 0, 0, 180, 45, () =>
      this.toast("IQ 为本局游戏表现值", 1600),
    );
  }
  faceKey(t: Tile) {
    if (t.kind === "normal") return FACE_KEYS[t.face % FACE_KEYS.length];
    return t.kind === "bomb" ? "effects.firecracker" : `ui.${t.kind}`;
  }
  card(t: Tile, w: number, h: number) {
    const c = this.add.container();
    c.setData("cardHeight", h);
    this.img(c, 2, 5, "f.play.tileShadow", w * 1.06, h * 1.05).setAlpha(0.8);
    this.img(
      c,
      0,
      0,
      t.hidden ? "f.play.backBlue" : "f.play.tilePlainBlue",
      w,
      h,
    );
    if (t.hidden && this.textures.exists("f.play.backPattern"))
      this.img(c, 0, 0, "f.play.backPattern", w, h);
    if (!t.hidden) {
      this.fit(c, -w * 0.015, -h * 0.035, this.faceKey(t), w * 0.83, h * 0.79);
      if (t.kind !== "normal" && !t.bonus) {
        const glow = this.add
          .graphics()
          .lineStyle(
            1.8,
            t.kind === "gift"
              ? 0xc48932
              : t.kind === "move"
                ? 0x4f8c84
                : 0xcc6b31,
            0.8,
          )
          .strokeRoundedRect(-w * 0.43, -h * 0.44, w * 0.86, h * 0.83, 6);
        c.add(glow);
      }
    }
    if (t.bonus) {
      const badge = this.add.container(0, -h * 0.39).setName("bonusBadge");
      badge.add(
        this.add
          .graphics()
          .fillStyle(0xa96320, 0.95)
          .fillRoundedRect(-w * 0.28, -9, w * 0.56, 18, 5),
      );
      this.txt(badge, 0, 0, "限时", Math.max(10, w * 0.16), "#fff0b9");
      c.add(badge);
    }
    return c;
  }
  renderBoard(state = this.p.s) {
    this.board.removeAll(true);
    this.tileViews.clear();
    this.boardPoints.clear();
    const projection = this.motionView || new BoardMotionView(this);
    const geometry = projection.geometry();
    this.boardW = geometry.w;
    this.boardH = geometry.h;
    for (const t of state.tiles)
      this.boardPoints.set(t.id, projection.position(t));
    projection.decorate(state);
    const sorted = state.tiles
      .filter((t) => projection.visible(state, t))
      .sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
    for (const t of sorted) {
      const pt = this.boardPoints.get(t.id)!;
      const width =
        t.bonus && t.y < 0 ? Math.min(72, this.boardW) : this.boardW;
      const c = this.card(t, width, width * 1.23).setPosition(pt.x, pt.y);
      this.board.add(c);
      this.tileViews.set(t.id, c);
      if (!exposed(state, t)) c.setAlpha(0.97);
      if (isQueued(state, t))
        c.setAlpha(state.movement?.type === "lines" ? 0.78 : 0.58);
      if (
        this.hintIds.includes(t.id) ||
        (this.p.stashMode && canStash(state, t))
      ) {
        const g = this.add
          .graphics()
          .lineStyle(this.hintIds.includes(t.id) ? 4 : 2, 0x57e5e4, 0.9)
          .strokeRoundedRect(
            -this.boardW * 0.46,
            -this.boardH * 0.47,
            this.boardW * 0.92,
            this.boardH * 0.91,
            7,
          );
        c.add(g);
      }
      this.hit(c, 0, -3, this.boardW * 0.94, this.boardH * 0.94, () =>
        this.tap(t.id),
      );
    }
  }
  hintMark(c: C, id: number, w: number, h: number) {
    c.getByName("hintGlow")?.destroy();
    if (this.hintIds.includes(id)) {
      const g = this.add
        .graphics()
        .setName("hintGlow")
        .lineStyle(4, 0x5de7ed, 0.95)
        .strokeRoundedRect(-w * 0.46, -h * 0.47, w * 0.92, h * 0.91, 6);
      c.add(g);
    }
  }
  currentPoint(id: number): Point {
    const i = this.p?.s.tray.indexOf(id) ?? -1;
    if (i >= 0) return this.trayPoint(i);
    if (this.p?.s.slot === id) return this.stashPoint();
    return this.boardPoints.get(id) || { x: W / 2, y: this.H / 2 };
  }
  layoutTray(ids: number[], animate = false) {
    this.visualTray = [...ids];
    for (const [id, c] of this.trayViews)
      if (!ids.includes(id)) {
        c.destroy();
        this.trayViews.delete(id);
      }
    ids.forEach((id, i) => {
      let c = this.trayViews.get(id);
      if (!c) {
        c = this.card(this.p.s.tiles.find((t) => t.id === id)!, 62, 77);
        this.trayLayer.add(c);
        this.hit(c, 0, 0, 62, 79, () => this.tap(id));
        this.trayViews.set(id, c);
      }
      this.hintMark(c, id, 62, 77);
      const pt = this.trayPoint(i);
      if (animate)
        this.tweens.add({
          targets: c,
          x: pt.x,
          y: pt.y,
          duration: 130,
          ease: "Sine.Out",
        });
      else c.setPosition(pt.x, pt.y);
    });
  }
  tap(id: number) {
    if (
      this.mode !== "play" ||
      this.modal ||
      this.dmElement ||
      this.hardLock ||
      this.transition ||
      this.motionPending ||
      this.pending > 10
    )
      return;
    const before = clone(this.p.s);
    const from = this.currentPoint(id);
    this.hintIds = [];
    const ev = this.p.tap(id);
    if (ev.some((e) => e.type === "collect")) this.lineMode?.action(id);
    if (
      ev.some(
        (e) => e.type === "collect" || e.type === "flip" || e.type === "stash",
      )
    ) {
      this.notice?.destroy();
      this.notice = undefined;
    }
    this.dispatch(ev, new Map([[id, from]]), before);
  }
  stash() {
    if (
      this.mode !== "play" ||
      this.modal ||
      this.dmElement ||
      this.hardLock ||
      this.pending
    )
      return;
    const before = clone(this.p.s),
      from =
        this.p.s.slot === null
          ? undefined
          : new Map([[this.p.s.slot, this.stashPoint()]]);
    this.dispatch(this.p.toggleStash(), from, before);
  }
  tool(tool: Tool) {
    if (
      this.mode !== "play" ||
      this.modal ||
      this.dmElement ||
      this.pending ||
      this.hardLock
    )
      return;
    this.lineMode?.tool();
    const before = clone(this.p.s);
    const points = new Map(
      live(before).map((t) => [t.id, this.currentPoint(t.id)]),
    );
    this.hintIds = [];
    const ev = this.p.use(tool);
    this.dispatch(ev, points, before);
  }
  dispatch(
    events: Event[],
    points = new Map<number, Point>(),
    before = clone(this.p.s),
  ) {
    if (!events.length) return;
    if (!events.some((e) => e.type === "experiment" && e.result === "iq"))
      this.visualBonusIQ = this.p.s.bonusIQ || 0;
    const receipt = events.find((e) => e.type === "gift" && e.inventoryBefore);
    if (receipt?.inventoryBefore)
      this.visualInventory = clone(receipt.inventoryBefore);
    else if (!events.some((e) => e.type === "gift"))
      this.visualInventory = clone(this.p.s.inventory);
    if (
      events.some((e) =>
        [
          "boardMove",
          "bonusSpawn",
          "bonusExpire",
          "gift",
          "experiment",
          "bomb",
          "lineClear",
        ].includes(e.type),
      )
    )
      this.motionPending = true;
    const epoch = this.epoch;
    this.renderBoard(
      this.p.s.movement ||
        events.some((e) =>
          ["shuffle", "flip", "gift", "experiment", "bomb"].includes(e.type),
        )
        ? before
        : this.p.s,
    );
    this.persist();
    for (const e of events) {
      if (e.type === "notice") {
        this.toast(e.text || "", 1900);
        continue;
      }
      if (e.type === "blocked") {
        if (Date.now() - this.lastBlockedNotice > 1800) {
          this.toast(e.text || "先解除这张牌的阻挡", 1800);
          this.lastBlockedNotice = Date.now();
        }
        for (const id of e.ids || []) {
          const c = this.tileViews.get(id);
          if (c)
            this.tweens.add({
              targets: c,
              x: c.x + 3,
              duration: 65,
              yoyo: true,
              repeat: 1,
            });
        }
        if (!this.blockedSoundPlayed) {
          this.blockedSoundPlayed = true;
          this.sfx("noMatch");
          this.persist();
        }
        continue;
      }
      this.pending++;
      this.chain = this.chain
        .then(async () => {
          if (epoch !== this.epoch) return;
          await this.eventFx(e, points, before);
        })
        .catch((err) => {
          console.error(err);
          this.toast("这次操作没有完成，请回退重试", 2500);
        })
        .finally(() => {
          if (epoch !== this.epoch) return;
          this.pending--;
          if (!this.pending) {
            this.motionPending = false;
            this.lineMode?.sync();
            this.renderBoard();
            this.visualInventory = clone(this.p.s.inventory);
            this.visualBonusIQ = this.p.s.bonusIQ || 0;
            this.layoutTray(this.p.s.tray, true);
            this.renderHud();
            this.persist();
            if (this.p.won) this.result();
            else if (this.p.goalFailed) this.lineGoalPanel();
            else if (this.p.full && !this.fullNotified) {
              this.fullNotified = true;
              this.fullTrayPanel();
            } else if (!this.p.full) this.fullNotified = false;
          }
        });
    }
    if (!this.pending) {
      this.renderHud();
      this.layoutTray(this.p.s.tray);
    }
  }
  async eventFx(e: Event, points: Map<number, Point>, before: any) {
    if (e.type === "lineClear") {
      await this.lineMode?.clear(e);
    } else if (e.type === "experiment") {
      await this.experimentView?.play(e);
    } else if (e.type === "bonusSpawn") {
      this.hardLock = true;
      for (const [i, id] of (e.ids || []).entries()) {
        const tile = this.p.s.tiles.find((t) => t.id === id)!;
        const to = this.motionView!.position(tile);
        this.tileViews.get(id)?.setVisible(false);
        const width = tile.y < 0 ? Math.min(72, this.boardW) : this.boardW;
        const card = this.card(tile, width, width * 1.23)
          .setPosition(to.x, -this.boardH)
          .setDepth(120)
          .setAngle(i ? -14 : 14);
        this.tweens.add({
          targets: card,
          y: to.y,
          angle: 0,
          duration: 520,
          delay: i * 80,
          ease: "Cubic.Out",
          onComplete: () => {
            this.spark(to.x, to.y, 0xffd86f, 25);
            card.destroy();
            this.tileViews.get(id)?.setVisible(true);
          },
        });
      }
      this.sfx("gift");
      this.notice?.destroy();
      this.notice = undefined;
      await this.sleep(620);
      this.renderBoard();
      this.hardLock = false;
    } else if (e.type === "bonusExpire") {
      this.hardLock = true;
      for (const id of e.ids || []) {
        const t = this.p.s.tiles.find((t) => t.id === id)!;
        const index = e.trayBefore?.indexOf(id) ?? -1;
        const point =
          index >= 0 ? this.trayPoint(index) : this.motionView!.position(t);
        this.spark(point.x, point.y, 0xc9bd8b, 8);
      }
      this.layoutTray(e.trayAfter || [], true);
      this.toast("限时礼盒已消退 · 继续解谜", 1800);
      await this.sleep(180);
      this.renderBoard();
      this.hardLock = false;
    } else if (e.type === "boardMove" && e.boardAfter) {
      if (
        e.boardAfter.movement?.type === "ring" &&
        e.boardBefore?.movement?.type === "ring"
      )
        this.flowDirection =
          e.boardAfter.movement.step < e.boardBefore.movement.step ? -1 : 1;
      const visual = { ...this.p.s, ...e.boardAfter } as State;
      this.renderBoard(visual);
      const projection = this.motionView!;
      for (const move of e.positions || []) {
        const c = this.tileViews.get(move.id);
        if (!c) continue;
        const movedTile = visual.tiles.find((t) => t.id === move.id)!;
        const from = projection.position({
            ...move.from,
            bonus: movedTile.bonus,
          }),
          to = projection.position({ ...move.to, bonus: movedTile.bonus });
        const alpha = c.alpha;
        const wrap =
          e.movement === "belt" &&
          !movedTile.bonus &&
          (Math.abs(move.to.x - move.from.x) > 1.5 ||
            Math.abs(move.to.y - move.from.y) > 1.5);
        if (wrap) {
          c.setPosition(to.x, to.y).setAlpha(0);
          this.tweens.add({ targets: c, alpha, duration: 170, delay: 150 });
          const tile = visual.tiles.find((t) => t.id === move.id)!;
          const ghost = this.card(tile, this.boardW, this.boardH)
            .setPosition(from.x, from.y)
            .setAlpha(alpha)
            .setDepth(5);
          this.tweens.add({
            targets: ghost,
            alpha: 0,
            duration: 150,
            onComplete: () => ghost.destroy(),
          });
          continue;
        }
        c.setPosition(from.x, from.y);
        if (
          (e.movement === "conveyor" && move.from.y >= 5) ||
          (e.movement === "lines" && move.from.y < 0)
        )
          c.setAlpha(0);
        this.tweens.add({
          targets: c,
          x: to.x,
          y: to.y,
          alpha,
          duration: 320,
          ease: "Cubic.InOut",
        });
      }
      this.sfx("click");
      await this.sleep(335);
    } else if (e.type === "collect") {
      const effectEpoch = this.epoch;
      await this.nativeFx?.collectBlast(e.ids![0]);
      if (effectEpoch !== this.epoch) return;
      const id = e.ids![0],
        t = this.p.s.tiles.find((t) => t.id === id)!;
      const from =
          (this.p.s.movement && e.source === "board"
            ? this.boardPoints.get(id)
            : points.get(id)) ||
          this.boardPoints.get(id) ||
          this.stashPoint(),
        to = this.trayPoint(e.index ?? 0);
      this.tileViews.get(id)?.setVisible(false);
      this.layoutTray(e.trayBefore || []);
      for (let i = e.index ?? 0; i < (e.trayBefore?.length || 0); i++) {
        const c = this.trayViews.get(e.trayBefore![i]);
        if (c)
          this.tweens.add({
            targets: c,
            x: this.trayPoint(i + 1).x,
            duration: 180,
          });
      }
      const startW =
        e.source === "slot"
          ? 64
          : t.bonus && t.y < 0
            ? Math.min(72, this.boardW)
            : this.boardW;
      const flying = this.card({ ...t, hidden: false }, startW, startW * 1.23)
        .setPosition(from.x, from.y)
        .setDepth(70);
      const tail = this.add.graphics().setDepth(69);
      let progress = 0;
      this.sfx("click");
      this.tweens.add({
        targets: { v: 0 },
        v: 1,
        duration: 280,
        ease: "Cubic.Out",
        onUpdate: (tw) => {
          progress = tw.getValue() ?? 0;
          const x = Phaser.Math.Linear(from.x, to.x, progress),
            y = Phaser.Math.Linear(from.y, to.y, progress);
          flying
            .setPosition(x, y)
            .setScale(Phaser.Math.Linear(1, 62 / startW, progress));
          tail
            .clear()
            .fillStyle(0xffdd84, 0.16 * (1 - progress))
            .fillTriangle(
              from.x - 12,
              from.y + 18,
              from.x + 12,
              from.y + 18,
              x,
              y,
            );
        },
        onComplete: () => tail.destroy(),
      });
      await this.sleep(285);
      flying.destroy();
      this.layoutTray(e.trayAfter || []);
      if (e.source === "slot") this.toast("配对完成后，暂存格会重新上锁", 1800);
      if (this.p.level.id === 1) this.learn("four-tray");
    } else if (e.type === "match") {
      this.layoutTray(e.trayBefore || []);
      const ids = e.ids || [];
      await this.sleep(160);
      for (const id of ids) {
        const i = this.visualTray.indexOf(id);
        if (i >= 0) {
          const c = this.trayViews.get(id);
          if (c)
            this.tweens.add({
              targets: c,
              scale: 1.08,
              duration: 75,
              yoyo: true,
            });
        }
      }
      await this.sleep(80);
      for (const id of ids) {
        const i = this.visualTray.indexOf(id);
        this.shatter(this.trayPoint(Math.max(0, i)).x, this.trayY());
      }
      this.sfx("match");
      this.comboFx?.match(
        e.combo ?? this.p.s.combo,
        e.bestCombo ?? this.p.s.bestCombo,
        (e.ids || []).includes(before.slotPending),
      );
      if (this.saveData.haptics) navigator.vibrate?.(12);
      this.layoutTray(e.trayAfter || [], true);
      this.drawIQ();
      await this.sleep(90);
    } else if (e.type === "unlock") {
      this.renderHud();
      this.nativeFx?.stars(this.stashPoint(), 18);
      this.sfx("gift");
      this.toast(e.text || "暂存已解锁 · 点空位，再选一张棋盘或槽内牌", 2600);
    } else if (e.type === "stash") {
      const id = e.ids![0],
        t = this.p.s.tiles.find((t) => t.id === id)!;
      const from = points.get(id) || this.boardPoints.get(id)!,
        to = this.stashPoint();
      if (this.p.s.movement) this.tileViews.get(id)?.setVisible(false);
      const startW = e.source === "tray" ? 62 : this.boardW;
      const card = this.card(t, startW, startW * 1.23)
        .setPosition(from.x, from.y)
        .setDepth(70);
      this.tweens.add({
        targets: card,
        x: to.x,
        y: to.y,
        scale: 64 / startW,
        duration: 280,
        ease: "Cubic.InOut",
      });
      await this.sleep(285);
      card.destroy();
      this.layoutTray(e.trayAfter || this.p.s.tray, true);
      this.renderHud();
      this.sfx("click");
      this.toast("暂存成功 · 点暂存牌可送回四格配对", 2300);
    } else if (e.type === "flip") {
      const id = e.ids![0],
        c = this.tileViews.get(id);
      if (c) {
        await this.tween(c, { scaleX: 0.04, duration: 100 });
        if (!c.active) return;
        c.removeAll(true);
        c.add(
          this.card(
            this.p.s.tiles.find((t) => t.id === id)!,
            this.boardW,
            this.boardH,
          ),
        );
        await this.tween(c, { scaleX: 1, duration: 130 });
        if (!c.active) return;
      }
      this.sfx("click");
      this.renderBoard();
    } else if (e.type === "undo") {
      this.hardLock = true;
      if (this.p.s.movement) {
        for (const [id, c] of this.tileViews) {
          const t = this.p.s.tiles.find((t) => t.id === id)!;
          const to = this.motionView!.position(t);
          this.tweens.add({
            targets: c,
            x: to.x,
            y: to.y,
            duration: 290,
            ease: "Cubic.InOut",
          });
        }
      }
      const changed = (e.restored || []).filter((r) => r.source === "board");
      for (const r of changed) {
        const t = this.p.s.tiles.find((t) => t.id === r.id)!;
        const from = points.get(r.id) || this.trayPoint(0),
          to = this.motionView!.position(t);
        const card = this.card(t, 62, 77)
          .setPosition(from.x, from.y)
          .setDepth(70);
        this.tileViews.get(r.id)?.setVisible(false);
        this.tweens.add({
          targets: card,
          x: to.x,
          y: to.y,
          scale: this.boardW / 62,
          duration: 290,
          ease: "Cubic.InOut",
          onComplete: () => card.destroy(),
        });
      }
      this.layoutTray(e.trayAfter || this.p.s.tray, true);
      this.sfx("undo");
      await this.sleep(300);
      this.renderBoard();
      this.hardLock = false;
    } else if (e.type === "hint") {
      this.hintIds = e.ids || [];
      this.renderBoard();
      this.sfx("hint");
      this.toast(e.text || "试试亮起的牌", 2100);
    } else if (e.type === "shuffle") {
      this.hardLock = true;
      const shuffledState = e.boardAfter
        ? ({ ...this.p.s, ...e.boardAfter } as State)
        : this.p.s;
      this.sfx("shuffle");
      this.layoutTray(e.trayAfter || []);
      await Promise.all(
        [...this.tileViews.entries()].map(async ([id, c]) => {
          const y = c.y;
          await this.sleep(Math.max(0, (y - this.H * 0.24) * 0.22));
          await this.tween(c, { scaleX: 0.04, y: y - 22, duration: 90 });
          c.removeAll(true);
          c.add(
            this.card(
              {
                ...shuffledState.tiles.find((t) => t.id === id)!,
                hidden: true,
              },
              this.boardW,
              this.boardH,
            ),
          );
          await this.tween(c, { scaleX: 1, duration: 90 });
          await this.sleep(40);
          await this.tween(c, { scaleX: 0.04, duration: 80 });
          c.removeAll(true);
          c.add(
            this.card(
              shuffledState.tiles.find((t) => t.id === id)!,
              this.boardW,
              this.boardH,
            ),
          );
          await this.tween(c, { scaleX: 1, y, duration: 100 });
        }),
      );
      this.renderBoard(shuffledState);
      this.hardLock = false;
    } else if (e.type === "bomb") {
      await this.nativeFx!.bomb(
        e,
        e.actor ? this.experimentView?.origin(e) : undefined,
      );
    } else if (e.type === "magnet") {
      this.hardLock = true;
      const magnet = this.fit(
        this.root,
        270,
        this.H * 0.47,
        "f.effects.magnetLarge",
        130,
        130,
      ).setDepth(80);
      this.tweens.add({
        targets: magnet,
        angle: -15,
        duration: 90,
        yoyo: true,
        repeat: 3,
      });
      const arc = this.add.graphics().setDepth(79);
      for (const [i, id] of (e.ids || []).entries()) {
        this.tileViews.get(id)?.setVisible(false);
        this.trayViews.get(id)?.setVisible(false);
        if (before.slot === id)
          (this.hud.getByName("stashCard") as C | null)?.setVisible(false);
        const t = this.p.s.tiles.find((t) => t.id === id)!,
          from = points.get(id) || this.boardPoints.get(id)!,
          to = this.trayPoint(i);
        const card = this.card(
          { ...t, hidden: false },
          this.boardW,
          this.boardH,
        )
          .setPosition(from.x, from.y)
          .setDepth(78);
        arc
          .lineStyle(3, 0x7df4ff, 0.9)
          .beginPath()
          .moveTo(270, this.H * 0.47)
          .lineTo(from.x + 25, from.y - 20)
          .lineTo(from.x, from.y)
          .strokePath();
        this.tweens.add({
          targets: card,
          x: to.x,
          y: to.y,
          scale: 62 / this.boardW,
          duration: 400,
          delay: 220,
          ease: "Cubic.In",
          onComplete: () => card.destroy(),
        });
      }
      this.sfx("firecrackerFly");
      await this.sleep(650);
      magnet.destroy();
      arc.destroy();
      this.shatter(200, this.trayY());
      this.shatter(264, this.trayY());
      this.sfx("match");
      this.comboFx?.match(
        e.combo ?? this.p.s.combo,
        e.bestCombo ?? this.p.s.bestCombo,
      );
      this.layoutTray(e.trayAfter || this.p.s.tray);
      this.hardLock = false;
    } else if (e.type === "gift") {
      await this.giftFx(e);
    }
  }
  async giftFx(e: Event) {
    await this.nativeFx!.gift(
      e,
      e.actor ? this.experimentView?.origin(e) : undefined,
    );
  }
  makeShardFrames() {
    const tex = this.textures.get("f.effects.whiteShards");
    for (let i = 0; i < 8; i++)
      if (!tex.has(`shard${i}`))
        tex.add(`shard${i}`, 0, (i % 4) * 64, Math.floor(i / 4) * 64, 64, 64);
  }
  shatter(x: number, y: number) {
    for (let i = 0; i < 46; i++) {
      const im = this.add
        .image(
          x + (Math.random() - 0.5) * 45,
          y + (Math.random() - 0.5) * 45,
          "f.effects.whiteShards",
          `shard${i % 8}`,
        )
        .setDepth(95)
        .setDisplaySize(7 + Math.random() * 17, 7 + Math.random() * 18)
        .setTint(0xdde0ff);
      this.particles.push({
        image: im,
        vx: (Math.random() - 0.5) * 200,
        vy: -80 - Math.random() * 290,
        spin: (Math.random() - 0.5) * 640,
        age: 0,
        life: 1.1 + Math.random() * 0.8,
      });
    }
    this.spark(x, y, 0xffdf81, 12);
  }
  spark(x: number, y: number, color: number, count: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2,
        d = 20 + Math.random() * 90,
        im = this.add.circle(x, y, 1 + Math.random() * 3, color).setDepth(96);
      this.tweens.add({
        targets: im,
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        alpha: 0,
        scale: 0,
        duration: 400 + Math.random() * 350,
        onComplete: () => im.destroy(),
      });
    }
  }
  encourage() {
    if (this.p.s.combo % 4 !== 0) return;
    const label = ["Great", "Amazing", "Excellent"][
      Math.min(2, Math.floor(this.p.s.combo / 12))
    ];
    const t = this.txt(this.root, 270, this.trayY() + 70, label, 29, "#fff0a0")
      .setDepth(99)
      .setStroke("#987017", 4)
      .setShadow(0, 3, "#456633", 2);
    this.tweens.add({
      targets: t,
      y: t.y - 10,
      alpha: 0,
      duration: 1000,
      delay: 180,
      onComplete: () => t.destroy(),
    });
  }
  sleep(ms: number) {
    return new Promise<void>((r) => this.time.delayedCall(ms, () => r()));
  }
  sfx(key: string) {
    if (this.saveData.sound && this.cache.audio.exists(`audio.${key}`))
      this.sound.play(`audio.${key}`, {
        volume: key === "explosion" ? 0.35 : 0.55,
      });
  }
  toast(text: string, duration = 2200) {
    if (!text) return;
    this.notice?.destroy();
    const y = this.mode === "play" ? this.H * 0.21 : this.H * 0.6;
    const c = this.add.container(270, y).setDepth(250);
    this.notice = c;
    const t = this.txt(c, 0, 0, text, 19, "#ffefc4").setWordWrapWidth(430);
    const h = Math.max(43, t.height + 16);
    const g = this.add
      .graphics()
      .fillStyle(0x181c10, 0.9)
      .fillRoundedRect(-238, -h / 2, 476, h, 5)
      .lineStyle(1, 0xb8a050, 0.8)
      .strokeRoundedRect(-238, -h / 2, 476, h, 5);
    c.addAt(g, 0);
    this.time.delayedCall(duration, () => {
      if (c.active)
        this.tweens.add({
          targets: c,
          alpha: 0,
          duration: 180,
          onComplete: () => c.destroy(),
        });
    });
  }
  panel(title: string, height: number, close = true) {
    this.notice?.destroy();
    this.notice = undefined;
    if (this.mode === "play" && this.paused === null) this.paused = Date.now();
    this.modal?.destroy();
    const c = this.add.container().setDepth(200);
    this.modal = c;
    c.add(
      this.add
        .rectangle(270, this.H / 2, W, this.H, 0x000000, 0.66)
        .setInteractive(),
    );
    if (this.game.renderer.type === Phaser.WEBGL) {
      const pane = this.add
        .nineslice(
          270,
          this.H / 2,
          "f.play.dialogPanel",
          undefined,
          940,
          height * 2,
          92,
          92,
          159,
          99,
        )
        .setScale(0.5);
      c.add(pane);
    } else this.img(c, 270, this.H / 2, "f.play.dialogPanel", 470, height);
    this.img(
      c,
      270,
      this.H / 2 - height / 2 + 23,
      "f.play.dialogHeader",
      492,
      65,
    );
    this.txt(c, 270, this.H / 2 - height / 2 + 24, title, 32, "#5f3216");
    if (close)
      this.nativeButton(
        c,
        492,
        this.H / 2 - height / 2 - 3,
        "f.play.closeButton",
        48,
        () => this.closePanel(),
      );
    return c;
  }
  green(
    parent: C,
    x: number,
    y: number,
    w: number,
    label: string,
    action: () => void,
    beige = false,
  ) {
    const c = this.add.container(x, y);
    parent.add(c);
    this.img(
      c,
      0,
      0,
      beige ? "f.play.beigeButton" : "f.play.greenButton",
      w,
      (w * 211) / 700,
    );
    this.txt(c, 0, -2, label, 32, beige ? "#8d5925" : "#ffffdf");
    this.hit(c, 0, 0, w, w * 0.31, () => {
      this.sfx("button");
      action();
    });
    return c;
  }
  fullTrayPanel() {
    if (this.mode !== "play" || !this.p.full || this.modal) return;
    this.fullNotified = true;
    const c = this.panel("没有空位了", 650, false),
      y = this.H / 2;
    c.setData("fullTray", true);
    if (
      this.p.s.bonus?.status === "active" &&
      this.p.s.bonus.ids.some((id) => this.p.s.tray.includes(id))
    )
      this.txt(
        c,
        270,
        y - 205,
        "限时礼盒消退后会自动腾出空位",
        17,
        "#875326",
      ).setName("bonusRecovery");
    this.img(c, 270, y - 100, "f.play.tray4", 350, 118);
    this.p.s.tray.forEach((id, i) => {
      const card = this.card(
        this.p.s.tiles.find((t) => t.id === id)!,
        81,
        100,
      ).setPosition(142 + i * 85, y - 107);
      c.add(card);
    });
    const stash = this.p.s.slotOpen && this.p.s.slotPending === null;
    const tool: Tool =
      this.p.s.inventory.undo > 0
        ? "undo"
        : this.p.s.inventory.magnet > 0
          ? "magnet"
          : "shuffle";
    this.green(
      c,
      270,
      y + 90,
      350,
      stash
        ? "暂存一张"
        : {
            undo: "回退一步",
            magnet: "磁铁解围",
            shuffle: "重新整理",
            hint: "线索",
          }[tool],
      () => {
        this.closePanel();
        if (stash) {
          this.stash();
          this.toast("点一张槽内牌，移入右侧暂存", 3200);
        } else this.tool(tool);
      },
    );
    this.green(
      c,
      270,
      y + 215,
      350,
      "重新开始",
      () => {
        const n = this.p.level.id;
        this.closePanel();
        this.play(n);
      },
      true,
    );
  }
  lineGoalPanel() {
    if (
      this.modal ||
      this.mode !== "play" ||
      this.pending ||
      !this.p.goalFailed
    )
      return;
    const m = this.p.s.movement;
    if (m?.type !== "lines") return;
    const c = this.panel("还差整线目标", 440),
      y = this.H / 2;
    this.txt(
      c,
      270,
      y - 85,
      `牌已清空，整线完成 ${m.cleared}/${m.target}`,
      22,
      "#785522",
    );
    this.txt(c, 270, y - 40, "消除顺序会决定能否拼出整线", 17, "#916238");
    this.green(c, 270, y + 35, 330, "回退一步", () => {
      if (this.p.s.inventory.undo <= 0 || !this.p.history.length) {
        this.toast("没有可回退的步骤，请重新挑战", 2000);
        return;
      }
      this.closePanel();
      this.tool("undo");
    });
    this.green(c, 270, y + 130, 330, "重新挑战", () => {
      this.closePanel();
      this.play(31);
    });
  }
  tween(
    target: object,
    config: Partial<Phaser.Types.Tweens.TweenBuilderConfig>,
  ) {
    return new Promise<void>((resolve) => {
      const object = target as Partial<Phaser.GameObjects.GameObject>;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        object.off?.("destroy", done);
        resolve();
      };
      object.once?.("destroy", done);
      this.tweens.add({
        ...config,
        targets: target,
        onComplete: done,
        onStop: done,
      });
    });
  }
  closePanel() {
    this.modal?.destroy();
    this.modal = undefined;
    if (this.paused !== null) {
      this.started += Date.now() - this.paused;
      this.paused = null;
    }
  }
  pause() {
    if (this.mode !== "play" || this.pending) return;
    const c = this.panel("暂停", 460),
      y = this.H / 2;
    this.green(c, 270, y - 85, 330, "继续游戏", () => this.closePanel());
    this.green(c, 270, y + 15, 330, "重新开始", () => {
      const n = this.p.level.id;
      this.closePanel();
      this.play(n);
    });
    this.green(c, 270, y + 115, 330, "返回首页", () => {
      this.persist();
      this.closePanel();
      this.home();
    });
  }
  settings() {
    const c = this.panel("设置", 450),
      y = this.H / 2;
    this.green(
      c,
      270,
      y - 70,
      340,
      `声音 ${this.saveData.sound ? "开启" : "关闭"}`,
      () => {
        this.saveData.sound = !this.saveData.sound;
        writeSave(this.saveData);
        this.settings();
      },
    );
    this.green(
      c,
      270,
      y + 35,
      340,
      `震动 ${this.saveData.haptics ? "开启" : "关闭"}`,
      () => {
        this.saveData.haptics = !this.saveData.haptics;
        writeSave(this.saveData);
        this.settings();
      },
    );
    this.txt(c, 270, y + 150, "配对消除 · 四格收牌 · 一次暂存", 18, "#916238");
  }
  levels() {
    const c = this.panel("关卡", 690),
      y = this.H / 2 - 242;
    for (let n = 1; n <= 30; n++) {
      const x = 86 + ((n - 1) % 5) * 92,
        yy = y + Math.floor((n - 1) / 5) * 82,
        open = n <= this.saveData.unlocked || this.test;
      const tile = this.img(c, x, yy, "f.play.tilePlainBlue", 64, 77).setAlpha(
        open ? 1 : 0.4,
      );
      this.txt(c, x, yy - 3, String(n), 25, "#275644");
      if (open)
        this.hit(c, x, yy, 75, 78, () => {
          this.closePanel();
          this.enter(n);
        });
    }
    this.green(c, 270, this.H / 2 + 278, 330, "31 · 整线实验", () => {
      this.closePanel();
      this.enter(31);
    });
  }
  ranks() {
    this.modal?.destroy();
    const c = this.add.container().setDepth(220);
    this.modal = c;
    c.add(
      this.add.rectangle(270, this.H / 2, W, this.H, 0x062d23).setInteractive(),
    );
    this.img(c, 135, this.H / 2 + 35, "f.rank.panel", 270, this.H - 70);
    this.img(
      c,
      405,
      this.H / 2 + 35,
      "f.rank.panel",
      270,
      this.H - 70,
    ).setFlipX(true);
    this.txt(c, 270, 69, "排行榜", 38, "#f9d987").setShadow(1, 2, "#4e3c17", 2);
    this.nativeButton(c, 38, 66, "f.play.backButton", 58, () =>
      this.closePanel(),
    );
    this.txt(c, 270, 117, "个人最佳 · 本机成绩", 17, "#c3d8b4");
    const rows = [...this.saveData.records].sort((a, b) => b.iq - a.iq);
    const podium = [
      { x: 270, y: this.H * 0.34, w: 154, h: 225, key: "firstPodium" },
      { x: 124, y: this.H * 0.37, w: 128, h: 160, key: "secondPodium" },
      { x: 416, y: this.H * 0.38, w: 128, h: 135, key: "thirdPodium" },
    ];
    podium.forEach((p, i) => {
      this.fit(c, p.x, p.y, `f.rank.${p.key}`, p.w, p.h);
      this.fit(c, p.x, p.y - p.h * 0.43 - 34, "f.home.profile", 72, 72);
      this.fit(
        c,
        p.x,
        p.y - p.h * 0.43 - 77,
        `f.rank.${["first", "second", "third"][i]}`,
        52,
        52,
      );
      this.txt(
        c,
        p.x,
        p.y + 14,
        rows[i] ? `第 ${rows[i].level} 关` : "—",
        22,
        "#75481f",
      );
      if (rows[i])
        this.txt(c, p.x, p.y + 47, rows[i].iq.toFixed(1), 23, "#67421b");
    });
    const start = this.H * 0.51;
    if (!rows.length) {
      this.txt(
        c,
        270,
        start + 45,
        "完成第一局，留下你的最佳成绩",
        23,
        "#dce5c2",
      );
    }
    rows.slice(0, 5).forEach((r, i) => {
      const y = start + i * 88;
      this.img(c, 270, y, "f.rank.card", 470, 78);
      this.txt(c, 67, y, String(i + 1), 23, "#ffdd85");
      this.fit(c, 124, y, "f.home.profile", 51, 51);
      this.txt(c, 239, y - 12, `第 ${r.level} 关`, 22, "#fff1d0");
      this.txt(c, 239, y + 17, `${r.score} 分`, 16, "#b8cdb0");
      this.txt(c, 442, y, r.iq.toFixed(1), 25, "#ffdf83");
    });
    this.txt(c, 270, this.H - 40, "挑战更多关卡，刷新你的纪录", 14, "#a5bca0");
  }
  result() {
    if (this.mode !== "play" || !this.p.won) return;
    this.elapsed = this.seconds();
    this.mode = "result";
    this.notice?.destroy();
    this.notice = undefined;
    const s = this.p.s,
      n = this.p.level.id,
      iq = this.iq();
    const old = this.saveData.records.find((r) => r.level === n);
    if (!old || s.score > old.score)
      this.saveData.records = this.saveData.records
        .filter((r) => r.level !== n)
        .concat({
          level: n,
          score: s.score,
          seconds: this.elapsed,
          iq,
          bestCombo: s.bestCombo,
          date: new Date().toISOString(),
        });
    if (n <= 30)
      this.saveData.unlocked = Math.max(
        this.saveData.unlocked,
        Math.min(30, n + 1),
      );
    delete this.saveData.current;
    writeSave(this.saveData);
    const c = this.add.container().setDepth(200);
    c.add(
      this.add
        .rectangle(270, this.H / 2, W, this.H, 0x00160e, 0.83)
        .setInteractive(),
    );
    this.fit(c, 231, this.H * 0.225, "ui.resultLotus", 115, 106).setAngle(-36);
    this.fit(c, 309, this.H * 0.225, "ui.resultLotus", 115, 106).setAngle(36);
    this.fit(c, 270, this.H * 0.21, "ui.resultLotus", 145, 146);
    this.fit(c, 270, this.H * 0.28, "ui.resultOrnament", W, 160);
    this.txt(
      c,
      270,
      this.H * 0.31,
      n === 31 ? "整线巧解" : n === 30 ? "巧解成章" : "才华横溢",
      55,
      "#ffe17b",
    )
      .setStroke("#826127", 2)
      .setShadow(0, 3, "#4c380a", 4);
    const metrics = [
      [
        "时间",
        `${Math.floor(this.elapsed / 60)
          .toString()
          .padStart(
            2,
            "0",
          )}:${(this.elapsed % 60).toString().padStart(2, "0")}`,
      ],
      ["分数", String(s.score)],
      s.movement?.type === "lines"
        ? ["整线", String(s.movement.cleared)]
        : ["连击", String(s.bestCombo)],
    ];
    metrics.forEach(([label, value], i) => {
      const x = 102 + i * 168,
        y = this.H * 0.43;
      const g = this.add
        .graphics()
        .fillStyle(0x181a0a, 0.9)
        .fillRoundedRect(x - 73, y - 44, 146, 88, 7)
        .lineStyle(1, 0x8a6e2c)
        .strokeRoundedRect(x - 73, y - 44, 146, 88, 7);
      c.add(g);
      this.txt(c, x, y - 22, label, 19, "#d4bb77");
      this.txt(c, x, y + 17, value, 29, "#ffe286");
    });
    this.txt(
      c,
      270,
      this.H * 0.56,
      `IQ ${iq.toFixed(1)} · 第 ${n} 关完成`,
      25,
      "#ead787",
    );
    this.txt(
      c,
      270,
      this.H * 0.6,
      "你的每一步，都在打开新的可能。",
      21,
      "#e6cb81",
    );
    const bar = this.add
      .graphics()
      .fillStyle(0x30342b)
      .fillRoundedRect(90, this.H * 0.68, 360, 11, 4)
      .fillStyle(0xe6ae42)
      .fillRoundedRect(90, this.H * 0.68, (360 * Math.min(n, 30)) / 30, 11, 4);
    c.add(bar);
    this.txt(
      c,
      270,
      this.H * 0.68 + 35,
      n === 31
        ? "整线目标与清空目标均已达成"
        : n === 30
          ? "三十关已完成"
          : `已完成 ${n} / 30 关`,
      17,
      "#c1b57d",
    );
    const y = this.H * 0.81;
    this.green(c, 270, y, 360, n >= 30 ? "返回首页" : `关卡 ${n + 1}`, () =>
      n >= 30 ? this.home() : this.enter(n + 1),
    );
    this.controls.next = { x: 270, y };
    this.sfx("win");
    this.spark(270, this.H * 0.28, 0xffcf65, 55);
  }
}
