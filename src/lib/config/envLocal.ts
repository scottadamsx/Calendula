import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const FILE_PATH = path.join(process.cwd(), ".env.local");

/**
 * Upserts key/value pairs into .env.local, preserving every other line
 * (comments, unrelated vars like ANTHROPIC_API_KEY) rather than overwriting
 * the whole file. Next's dev server watches this file and reloads process.env
 * live — confirmed empirically, no restart needed for plain env var changes
 * (unlike middleware/proxy source changes).
 */
export async function upsertEnvLocal(values: Record<string, string>): Promise<void> {
  let existingLines: string[] = [];
  try {
    const raw = await readFile(FILE_PATH, "utf-8");
    existingLines = raw.split("\n");
  } catch {
    existingLines = [];
  }

  const remainingKeys = new Set(Object.keys(values));
  const updatedLines = existingLines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (match && remainingKeys.has(match[1])) {
      const key = match[1];
      remainingKeys.delete(key);
      return `${key}=${values[key]}`;
    }
    return line;
  });

  // Strip trailing blank lines before appending anything new.
  while (updatedLines.length > 0 && updatedLines[updatedLines.length - 1] === "") {
    updatedLines.pop();
  }

  for (const key of remainingKeys) {
    updatedLines.push(`${key}=${values[key]}`);
  }

  await writeFile(FILE_PATH, `${updatedLines.join("\n")}\n`, "utf-8");
}
