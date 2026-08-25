import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../src");
const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(target);
  }
};
walk(root);
const broken = files.filter((file) => /300_000\s*\*\s*60_000/.test(fs.readFileSync(file, "utf8")));
if (broken.length) {
  console.error(`208-day polling typo found in:\n${broken.join("\n")}`);
  process.exit(1);
}
console.log("✓ check:live-polling — five-minute live refresh typo absent.");
