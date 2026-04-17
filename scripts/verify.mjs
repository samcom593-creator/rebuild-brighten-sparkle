#!/usr/bin/env node
// CI gate: typecheck + build. Run with `node scripts/verify.mjs`
import { execSync } from "node:child_process";

const steps = [
  { name: "TypeScript check", cmd: "tsc --noEmit" },
  { name: "Vite build", cmd: "vite build" },
];

for (const step of steps) {
  console.log(`\n▶ ${step.name}...`);
  try {
    execSync(step.cmd, { stdio: "inherit" });
    console.log(`✓ ${step.name} passed`);
  } catch (err) {
    console.error(`✗ ${step.name} failed`);
    process.exit(1);
  }
}

console.log("\n✓ All gates passed");
