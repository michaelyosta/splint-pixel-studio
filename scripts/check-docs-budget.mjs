#!/usr/bin/env node
// Docs budget check: caps canonical docs churn per branch.
// Usage: node scripts/check-docs-budget.mjs [--base origin/main] [--max 3]
// Counts added/modified docs/**/*.md files outside docs/evidence/ from both
// the committed range (merge-base with --base ... HEAD) and the working tree
// (staged, unstaged, and untracked files), and fails when over --max.
// Evidence files are listed, never failed. CURRENT_STATE.md over 200 lines
// is a warning, not a failure (it is rewritten by policy, not frozen).
import { execFileSync } from "node:child_process";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) return fallback;
  return v;
}

const base = arg("--base", "origin/main");
const max = Number(arg("--max", "3"));

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const seen = new Set();
function add(p) {
  const f = String(p).trim();
  if (f) seen.add(f);
}

try {
  const mergeBase = git("merge-base", "HEAD", base);
  console.log(`Base: ${base} (${mergeBase.slice(0, 12)})`);
  const raw = git("diff", "--name-only", "--diff-filter=ACM", `${mergeBase}...HEAD`);
  raw.split("\n").forEach(add);
} catch {
  console.error(`Cannot resolve merge-base with ${base}. Fetch it first (git fetch origin main).`);
  process.exit(2);
}

// Working tree: staged + unstaged + untracked, so pre-PR local runs see new files.
// Porcelain v1 has two status columns followed by a path, but leading
// whitespace may be trimmed in transit, so the status prefix is stripped
// with a pattern instead of a fixed slice. Renames (old -> new) count the
// new path.
try {
  const porcelain = git("status", "--porcelain", "--", "docs");
  for (const line of porcelain.split("\n")) {
    let f = line.replace(/^.{0,2}\s+/, "").trim().replace(/^"(.*)"$/, "$1");
    const arrow = f.indexOf(" -> ");
    if (arrow !== -1) f = f.slice(arrow + 4);
    add(f);
  }
} catch {
  console.warn("WARNING: git status unavailable; counting committed range only.");
}

const docsFiles = [...seen].filter((f) => f.endsWith(".md") && (f === "docs/CURRENT_STATE.md" || f.startsWith("docs/")));
const evidence = docsFiles.filter((f) => f.startsWith("docs/evidence/")).sort();
const canonical = docsFiles.filter((f) => !f.startsWith("docs/evidence/")).sort();

console.log(`Canonical docs changed (${canonical.length}/${max}):`);
for (const f of canonical) console.log(`  ${f}`);
console.log(`Evidence files (${evidence.length}, uncapped):`);
for (const f of evidence) console.log(`  ${f}`);

let failed = false;
if (canonical.length > max) {
  console.error(
    `Docs budget exceeded: ${canonical.length}/${max}. ` +
    `Keep normal PRs to ${max} docs/*.md files (evidence excluded), ` +
    `or label the PR contract-change with an OLD/NEW/WHY/TESTED migration note.`
  );
  failed = true;
}

// CURRENT_STATE.md bounded-length advisory (policy target: under 200 lines).
try {
  const content = git("show", "HEAD:docs/CURRENT_STATE.md");
  const lines = content.split("\n").length;
  console.log(`CURRENT_STATE.md lines: ${lines} (target < 200)`);
  if (lines > 200) {
    console.warn("WARNING: CURRENT_STATE.md exceeds 200 lines; rewrite it, do not append history.");
  }
} catch {
  console.warn("WARNING: docs/CURRENT_STATE.md not readable at HEAD; skipping length check.");
}

if (failed) process.exit(1);
console.log("Docs budget: OK");
