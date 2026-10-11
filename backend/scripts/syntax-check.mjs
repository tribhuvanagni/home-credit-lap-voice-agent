// Lightweight static check: parses every source and test file.
//
// Stands in for a linter without adding an ESLint toolchain to the project. It catches
// the failure that actually matters here — a file that cannot be parsed — and it runs in
// well under a second.

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [path.join(here, "../src"), path.join(here, "../../tests")];

function collect(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (full.endsWith(".js") || full.endsWith(".mjs")) out.push(full);
  }
  return out;
}

const files = roots.flatMap(collect);
const failures = [];

for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failures.push({ file, message: error.stderr?.toString() ?? error.message });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL ${path.relative(process.cwd(), failure.file)}\n${failure.message}`);
  }
  console.error(`\n${failures.length} of ${files.length} file(s) failed to parse.`);
  process.exit(1);
}

console.log(`OK — ${files.length} file(s) parsed cleanly.`);
