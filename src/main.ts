import Phaser from "phaser";
import { FidelityScene } from "./scenes/FidelityScene";
import { makeLevels, makeLineLevel, type Layout } from "./core/levels";
import type { Level } from "./core/model";
import type { NativeClips } from "./ui/native-effects";

export type AssetManifest = Record<
  "faces" | "ui" | "effects" | "audio",
  Record<string, string>
>;
export interface AppData {
  nativeClips: NativeClips;
  manifest: AssetManifest;
  levels: Level[];
  height: number;
  quotes: { text: string; author: string }[];
  fidelity: Record<string, Record<string, any>>;
}
async function start() {
  const manifest: AssetManifest = await fetch("./assets/manifest.json").then(
    (r) => {
      if (!r.ok) throw new Error("素材清单加载失败");
      return r.json();
    },
  );
  let layouts: Layout[] = [];
  try {
    const data = await fetch("./assets/levels.json").then((r) =>
      r.ok ? r.json() : null,
    );
    layouts = data?.layouts || [];
  } catch {}
  const levels = [...makeLevels(layouts), makeLineLevel()];
  const height = Math.max(
    960,
    Math.min(1250, Math.round((540 * innerHeight) / innerWidth)),
  );
  let quotes: { text: string; author: string }[] = [];
  try {
    const texts = await fetch("./assets/texts.json").then((r) => r.json());
    quotes = texts.quotes
      .map((q: any) => ({ text: q.zhCN, author: q.author }))
      .filter((q: any) => q.text?.length < 44 && q.author);
  } catch {}
  const fidelity = await fetch("./assets/fidelity/manifest.json").then((r) =>
    r.json(),
  );
  const nativeClips: NativeClips = await fetch(
    "./assets/reward-fx/baked/animations.json",
  ).then((r) => {
    if (!r.ok) throw Error("原版动画清单加载失败");
    return r.json();
  });
  const app: AppData = {
    manifest,
    levels,
    height,
    quotes,
    fidelity,
    nativeClips,
  };
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: 540,
    height,
    backgroundColor: "#103c32",
    render: {
      antialias: true,
      roundPixels: false,
      preserveDrawingBuffer: new URLSearchParams(location.search).has("test"),
    },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    audio: { disableWebAudio: false },
    scene: [FidelityScene],
    callbacks: { preBoot: (g) => g.registry.set("app", app) },
  });
  (window as any).__game = game;
  // Tests can wait on the real animation loop without changing runtime semantics.
  (window as any).advanceTime = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
}
start().catch((e) => {
  const el = document.getElementById("loading")!;
  el.textContent = "牌桌加载失败，请刷新重试";
  console.error(e);
});
