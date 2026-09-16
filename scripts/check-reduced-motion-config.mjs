#!/usr/bin/env node
// check:reduced-motion-config (2026-09-15, a11y wave)
//
// framer-motion animates through JS / the Web Animations API, so the
// `@media (prefers-reduced-motion: reduce)` override in src/index.css does not
// reach it. The one switch that does is <MotionConfig reducedMotion="user">
// at the app root; 117 files import framer-motion and inherit it from there.
//
// This guard fails when that provider is missing, not at the root, or not set
// to "user" (the value "always" would strip motion for everyone; "never" is the
// bug this exists to prevent). It reads App.tsx as text (no compiler) so it
// costs ~10 ms, and it walks the JSX nesting rather than grepping a string so
// a MotionConfig left inside one route cannot satisfy it.
import { readFileSync } from "node:fs";

const path = "src/App.tsx";
const src = readFileSync(path, "utf8");
const fail = (msg) => { console.error(`✗ check:reduced-motion-config — ${msg}`); process.exit(1); };

const importRe = /import\s*\{[^}]*\bMotionConfig\b[^}]*\}\s*from\s*["']framer-motion["']/;
if (!importRe.test(src)) fail(`${path} does not import MotionConfig from framer-motion`);

const openIdx = src.search(/<MotionConfig\b/);
if (openIdx < 0) fail(`${path} never renders <MotionConfig>`);
const openTag = src.slice(openIdx, src.indexOf(">", openIdx) + 1);
if (!/reducedMotion\s*=\s*["']user["']/.test(openTag)) fail(`<MotionConfig> must set reducedMotion="user" (found: ${openTag.slice(0, 80)})`);

// Root check: the provider must wrap AuthProvider (the outermost app-level
// provider), so every routed surface — public landing, dashboards, login — is inside it.
const authIdx = src.search(/<AuthProvider\b/);
const closeIdx = src.lastIndexOf("</MotionConfig>");
if (authIdx < 0) fail(`${path} has no <AuthProvider>; update this guard if the root provider was renamed`);
if (!(openIdx < authIdx && closeIdx > src.lastIndexOf("</AuthProvider>"))) fail(`<MotionConfig> must wrap <AuthProvider> at the app root (open ${openIdx}, auth ${authIdx}, close ${closeIdx})`);

const motionFiles = src.length; // silence unused warnings in strict setups
console.log(`✓ check:reduced-motion-config — <MotionConfig reducedMotion="user"> wraps the app root in ${path}`);
void motionFiles;
