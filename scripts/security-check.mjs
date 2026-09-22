import "dotenv/config";
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { execFileSync } from "node:child_process";
const keys = [
  "DATABASE_URL",
  "DIRECT_URL",
  "JWT_SECRET",
  "FABIO_PASSWORD",
  "BIANCA_PASSWORD",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const secrets = keys
  .map((k) => [k, process.env[k]])
  .filter(
    ([k, v]) =>
      v && v.length >= 8 && !["configure-me", "change-me"].includes(v),
  );
for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
  try {
    const pw = decodeURIComponent(new URL(process.env[key]).password);
    if (pw.length >= 8) secrets.push([key + "_PASSWORD", pw]);
  } catch {}
}
const findings = [];
let checked = 0;
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      [
        "node_modules",
        ".git",
        ".local",
        ".pnpm-store",
        "test-results",
        "playwright-report",
        ".codex",
        ".agents",
      ].includes(entry.name) ||
      (entry.name.startsWith(".env") && entry.name !== ".env.example")
    )
      continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (
      [
        ".ts",
        ".tsx",
        ".js",
        ".mjs",
        ".json",
        ".md",
        ".yaml",
        ".yml",
        ".css",
        ".html",
        ".prisma",
        ".sql",
        ".txt",
      ].includes(extname(path)) ||
      entry.name === ".env.example"
    ) {
      checked++;
      const text = readFileSync(path, "utf8");
      for (const [key, value] of secrets)
        if (text.includes(value)) findings.push({ path, key });
    }
  }
}
walk(".");
const ignore = readFileSync(".gitignore", "utf8");
const environmentIgnored = [".env", ".env.*", "!.env.example"].every((p) =>
  ignore.split(/\r?\n/).includes(p),
);
let git = "not-initialized",
  trackedEnv = [];
if (existsSync(".git")) {
  git = "checked";
  trackedEnv = execFileSync("git", ["ls-files", "--", ".env", ".env.*"], {
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter((x) => x && x !== ".env.example");
}
const result = {
  passed:
    findings.length === 0 && environmentIgnored && trackedEnv.length === 0,
  checked,
  environmentIgnored,
  git,
  trackedEnv,
  findings,
};
writeFileSync("docs/security-check.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (!result.passed) process.exitCode = 1;
