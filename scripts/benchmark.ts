import { writeFileSync } from "fs";
import { runBenchmark } from "@/lib/audit/benchmark";

const weeks = Number(process.argv[2] ?? 300);
const summary = runBenchmark(weeks);
writeFileSync("benchmark-results.json", JSON.stringify(summary, null, 2) + "\n");
console.log(`${weeks} weeks, seed ${summary.seed}`);
console.table(summary.schedulers.map(({ name, ...rest }) => ({ scheduler: name, ...rest })));
