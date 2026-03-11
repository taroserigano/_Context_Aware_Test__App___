import { readFileSync } from "fs";
import path from "path";

export function parseJsonl(filePath) {
  const resolved = path.resolve(filePath);
  const content = readFileSync(resolved, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}
