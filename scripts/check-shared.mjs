#!/usr/bin/env node
// Drift guard for code that is intentionally DUPLICATED across the Web repo (this one) and the iOS
// repo (sibling `../anki-sheet-ios`). The shared modules have no single source of truth yet (§5.1
// deferred), so they are hand-copied — and have silently diverged before (the bmKey NUL bug). This
// script fails the moment any copy drifts, so drift is caught AT COMMIT, not in production.
//
// Run:  npm run check:shared   (wire into a pre-commit hook / CI)
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const iosRoot = join(webRoot, "..", "anki-sheet-ios");

// Each group = a list of files that MUST be byte-identical (ignoring line endings).
const groups = [
  {
    name: "progressMerge.ts (LWW sync — backend / web / iOS)",
    files: [
      join(webRoot, "functions/_lib/progressMerge.ts"),
      join(webRoot, "src/sync/progressMerge.ts"),
      join(iosRoot, "src/sync/progressMerge.ts"),
    ],
  },
  {
    name: "cardKeys.ts (★/revealed position keys — web ↔ iOS)",
    files: [join(webRoot, "src/sync/cardKeys.ts"), join(iosRoot, "src/sync/cardKeys.ts")],
  },
  {
    name: "contentMerge.ts (mask/cloze LWW — backend / web / iOS)",
    files: [
      join(webRoot, "functions/_lib/contentMerge.ts"),
      join(webRoot, "src/sync/contentMerge.ts"),
      join(iosRoot, "src/sync/contentMerge.ts"),
    ],
  },
  {
    name: "srs.ts (SM-2 + reviews LWW — web ↔ iOS)",
    files: [join(webRoot, "src/sync/srs.ts"), join(iosRoot, "src/sync/srs.ts")],
  },
  {
    name: "detect/* (pure color-detection engine — web ↔ iOS engine-src)",
    files: ["colorBand.ts", "detectPage.ts", "heightFilter.ts", "pixelSampler.ts", "runGeometry.ts"]
      .flatMap((f) => [
        join(webRoot, "src/detect", f),
        join(iosRoot, "engine-src/src/detect", f),
      ]),
    // pair web↔iOS per filename
    pairByBasename: true,
  },
];

const norm = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n").replace(/\s+$/, "");
const short = (p) => p.replace(webRoot, "web").replace(iosRoot, "ios");

let failures = 0;
let skipped = 0;

for (const g of groups) {
  if (g.pairByBasename) {
    // Compare each (web, iOS) pair sharing a basename.
    const byBase = new Map();
    for (const f of g.files) {
      const base = f.split(/[\\/]/).pop();
      (byBase.get(base) ?? byBase.set(base, []).get(base)).push(f);
    }
    for (const [base, pair] of byBase) {
      const present = pair.filter(existsSync);
      if (present.length < 2) {
        console.warn(`  ⚠ skip ${g.name} :: ${base} (a copy is missing — iOS repo not checked out?)`);
        skipped++;
        continue;
      }
      const [a, b] = present;
      if (norm(a) === norm(b)) {
        console.log(`  ✓ ${base}`);
      } else {
        console.error(`  ✗ DRIFT: ${base}\n      ${short(a)}\n      ${short(b)}`);
        failures++;
      }
    }
  } else {
    const present = g.files.filter(existsSync);
    if (present.length < g.files.length) {
      console.warn(`  ⚠ ${g.name}: only ${present.length}/${g.files.length} copies present (iOS repo not checked out?)`);
      skipped++;
    }
    if (present.length < 2) continue;
    const base = norm(present[0]);
    let ok = true;
    for (const f of present.slice(1)) {
      if (norm(f) !== base) {
        console.error(`  ✗ DRIFT: ${short(f)} differs from ${short(present[0])}`);
        failures++;
        ok = false;
      }
    }
    if (ok) console.log(`  ✓ ${g.name} (${present.length} copies identical)`);
  }
}

if (failures > 0) {
  console.error(`\n✗ ${failures} drift(s) detected. Sync the copies before committing.`);
  process.exit(1);
}
console.log(`\n✓ shared copies in sync${skipped ? ` (${skipped} group(s) skipped — iOS repo not present)` : ""}.`);
