import fs from "node:fs";
import { makeLevels } from "../src/core/levels";
import { Puzzle } from "../src/core/rules";
import { solve } from "../src/core/solver";
const file = "src/core/dynamic-level-data.json";
const data = JSON.parse(fs.readFileSync(file, "utf8"));
for (const level of makeLevels().filter(l => l.movement)) {
  const old = new Puzzle(level);
  for (const action of level.solution!) old.apply(action);
  if (old.won) { console.log(level.id, "existing witness valid"); continue; }
  const p = new Puzzle(level);
  const start = performance.now();
  const plan = solve(p.s, 2000000, 15000);
  if (!plan) throw Error(`No certified solution for ${level.id}`);
  for (const action of plan) p.apply(action);
  if (!p.won) throw Error(`Replay failed ${level.id}`);
  data.find((row: {id:number}) => row.id === level.id).solution = plan;
  console.log(level.id, "recertified", plan.length, "actions", Math.round(performance.now()-start), "ms");
}
fs.writeFileSync(file, JSON.stringify(data, null, 2)+"\n");
