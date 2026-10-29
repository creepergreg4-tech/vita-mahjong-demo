export interface RecordRow {
  level: number;
  score: number;
  seconds: number;
  iq: number;
  bestCombo: number;
  date: string;
}
export interface Save {
  unlocked: number;
  records: RecordRow[];
  sound: boolean;
  haptics: boolean;
  tutorials: string[];
  current?: {
    level: number;
    seconds: number;
    puzzle: any;
    blockedSoundPlayed?: boolean;
    beltElapsedMs?: number;
  };
}
const key = "vita-clever-pairs-rules3";
export function readSave(): Save {
  try {
    const s = JSON.parse(localStorage.getItem(key) || "null");
    if (s && Array.isArray(s.records))
      return {
        unlocked: Math.max(1, Math.min(30, Number(s.unlocked) || 1)),
        records: s.records,
        sound: s.sound !== false,
        haptics: s.haptics !== false,
        tutorials: s.tutorials || [],
        current:
          s.current?.level >= 1 && s.current?.level <= 31
            ? s.current
            : undefined,
      };
  } catch {}
  return {
    unlocked: 1,
    records: [],
    sound: true,
    haptics: true,
    tutorials: [],
  };
}
export function writeSave(s: Save) {
  try {
    localStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* Gameplay remains available when private mode storage is unavailable. */
  }
}
export const quoteFallback = [
  { text: "千里之行，始于足下。", author: "《道德经》" },
  { text: "知之者不如好之者，好之者不如乐之者。", author: "《论语》" },
  { text: "不积跬步，无以至千里。", author: "《荀子·劝学》" },
  { text: "学而时习之，不亦说乎。", author: "《论语》" },
];
