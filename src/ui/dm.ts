import type { FidelityScene } from "../scenes/FidelityScene";

/** A real numeric input opens the phone keyboard and supports paste/Enter. */
export function openLevelDM(g: FidelityScene) {
  if (g.pending || g.transition || g.dmElement || g.modal) return;
  g.input.enabled = false;
  if (g.mode === "play" && g.paused === null) g.paused = Date.now();
  const overlay = document.createElement("div");
  g.dmElement = overlay;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "DM 测试选关");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:10000;background:#001b16bd;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;overflow:auto;touch-action:pan-y;font-family:Arial,'Microsoft YaHei',sans-serif;color:#56391d";
  const card = document.createElement("form");
  card.style.cssText = `box-sizing:border-box;width:100%;max-width:390px;max-height:calc(100dvh - 32px);overflow-y:auto;padding:26px 24px;background:#f7e6be url('${g.app.fidelity.play.dialogPanel}') center/100% 100%;border-radius:20px;box-shadow:0 12px 40px #0008;text-align:center`;
  card.innerHTML = `<h2 style="margin:0 0 8px;font-size:24px">DM 测试选关</h2>
    <p style="font-size:14px;margin:0 0 18px">1—30 主线 · 31 整线实验</p>
    <label for="dm-level">关卡编号</label>
    <input id="dm-level" name="level" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" style="box-sizing:border-box;width:100%;margin:8px 0;padding:12px;font-size:24px;text-align:center;border:2px solid #b58645;border-radius:10px;background:#fff8e7;color:#56391d">
    <p role="status" style="min-height:20px;font-size:14px;margin:0 0 8px;color:#a32a13"></p>
    <button type="submit" style="width:100%">进入关卡</button>
    <p style="margin:18px 0 8px;font-size:14px">机制快捷入口</p>
    <div class="dm-quick" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"></div>
    <button type="button" class="dm-close" style="width:100%;margin-top:16px">返回游戏</button>`;
  overlay.append(card);
  document.body.append(overlay);
  const input = card.querySelector("input")!;
  input.value = String(g.mode === "play" ? g.p.level.id : g.saveData.unlocked);
  const styleButton = (b: HTMLButtonElement, primary = false) => {
    b.style.cssText += `;min-height:44px;padding:8px;border:0;border-radius:10px;font-size:16px;color:${primary ? "#fff4c8" : "#613a17"};background:transparent url('${g.app.fidelity.play[primary ? "greenButton" : "beigeButton"]}') center/100% 100%;cursor:pointer`;
  };
  const start = (n: number) => {
    closeLevelDM(g);
    g.play(n);
  };
  card.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = input.value.trim(),
      n = Number(raw);
    if (
      !/^\d+$/.test(raw) ||
      !Number.isInteger(n) ||
      n < 1 ||
      n > g.app.levels.length
    ) {
      card.querySelector('[role="status"]')!.textContent =
        `请输入 1 到 ${g.app.levels.length} 的整数`;
      return;
    }
    start(n);
  });
  for (const [n, label] of [
    [31, "31 · 整线巧解"],
    [2, "2 · 暂存教学"],
    [5, "5 · 蓝背翻牌"],
    [7, "7 · 爆破牌"],
    [13, "13 · 首次礼盒"],
    [14, "14 · 随机礼盒"],
    [16, "16 · 外圈旋转"],
    [17, "17 · 龙息送福"],
    [19, "19 · 幸运转轮"],
    [20, "20 · 回流棋局"],
    [21, "21 · 向上补牌"],
    [24, "24 · 定时右移"],
    [27, "27 · 定时上移"],
    [26, "26 · 龙息进阶"],
    [29, "29 · 转轮进阶"],
    [28, "28 · 补牌挑战"],
  ] as const) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => {
      if (n === 2)
        g.saveData.tutorials = g.saveData.tutorials.filter(
          (k) => k !== "stash-flow-v1" && k !== "move",
        );
      if (n === 31)
        g.saveData.tutorials = g.saveData.tutorials.filter(
          (k) => k !== "lines-v1",
        );
      start(n);
    });
    card.querySelector(".dm-quick")!.append(b);
  }
  const bonusButton = document.createElement("button");
  bonusButton.type = "button";
  bonusButton.textContent = "限时宝箱演示";
  bonusButton.addEventListener("click", () => {
    start(22);
    g.learn("stash-flow-v1");
    g.p.s.unbelievableCount = 2;
    g.dispatch(g.p.startBonus());
  });
  card.querySelector(".dm-quick")!.append(bonusButton);
  const giftButton = document.createElement("button");
  giftButton.type = "button";
  giftButton.textContent = "宝箱开箱演示";
  giftButton.addEventListener("click", () => {
    start(13);
    // Deterministic positive receipt only for the explicitly labelled FX demo.
    g.p.s.seed = 1;
    g.dispatch(g.p.gift());
  });
  card.querySelector(".dm-quick")!.append(giftButton);
  card
    .querySelectorAll("button")
    .forEach((b) => styleButton(b, b.type === "submit"));
  card
    .querySelector(".dm-close")!
    .addEventListener("click", () => closeLevelDM(g));
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLevelDM(g);
  });
  input.focus();
  input.select();
}

export function closeLevelDM(g: FidelityScene) {
  g.dmElement?.remove();
  g.dmElement = undefined;
  g.input.enabled = true;
  if (g.paused !== null && !g.modal) {
    g.started += Date.now() - g.paused;
    g.paused = null;
  }
}
