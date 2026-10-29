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
async function loadJSON(url: string): Promise<any> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return await response.json();
    } catch (error) {
      last = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}
async function start() {
  const manifest: AssetManifest = await loadJSON("./assets/manifest.json");
  let layouts: Layout[] = [];
  try {
    const data = await loadJSON("./assets/levels.json");
    layouts = data?.layouts || [];
  } catch {}
  const levels = [...makeLevels(layouts), makeLineLevel()];
  const height = Math.max(
    960,
    Math.min(1250, Math.round((540 * innerHeight) / innerWidth)),
  );
  let quotes: { text: string; author: string }[] = [];
  try {
    const texts = await loadJSON("./assets/texts.json");
    quotes = texts.quotes
      .map((q: any) => ({ text: q.zhCN, author: q.author }))
      .filter((q: any) => q.text?.length < 44 && q.author);
  } catch {}
  const fidelity = await loadJSON("./assets/fidelity/manifest.json");
  const nativeClips: NativeClips = await loadJSON("./assets/reward-fx/baked/animations.json");
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
    loader: { maxParallelDownloads: 6, maxRetries: 3, timeout: 20000 },
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
  el.onclick = () => location.reload();
  console.error(e);
});
