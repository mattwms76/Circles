import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIRECTORIES = [
  "app/",
  "components/",
  "constants/",
  "hooks/",
  "lib/",
  "server/",
  "shared/",
  "tests/",
  "e2e/",
  "scripts/",
  "operations/tests/",
  ".github/workflows/",
];
const ROOT_CONFIGURATION = new Set([
  "app.config.ts",
  "babel.config.js",
  "metro.config.js",
  "eslint.config.js",
  "eslint.config.mjs",
  "tailwind.config.js",
  "drizzle.config.ts",
  "eas.json",
  "package.json",
  "tsconfig.json",
]);
const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".yaml",
  ".yml",
  ".css",
]);

export function isSourceFormattingPath(filename) {
  if (
    typeof filename !== "string" ||
    !filename ||
    filename.includes("\\") ||
    /[\0\r\n]/.test(filename)
  )
    return false;
  if (
    path.posix.isAbsolute(filename) ||
    filename.split("/").some((part) => part === "." || part === ".." || !part)
  )
    return false;
  if (
    filename === "scripts/design-audit-workflow.js" ||
    filename.split("/").some((part) => part.startsWith("."))
  )
    return (
      ROOT_CONFIGURATION.has(filename) ||
      (filename.startsWith(".github/workflows/") &&
        EXTENSIONS.has(path.posix.extname(filename)))
    );
  return (
    EXTENSIONS.has(path.posix.extname(filename)) &&
    (ROOT_CONFIGURATION.has(filename) ||
      SOURCE_DIRECTORIES.some((prefix) => filename.startsWith(prefix)))
  );
}

export function collectSourceFormattingFiles(projectRoot, candidates) {
  const root = realpathSync(projectRoot);
  return [...new Set(candidates)]
    .filter(isSourceFormattingPath)
    .filter((filename) => {
      try {
        const absolute = path.join(root, filename);
        if (!lstatSync(absolute).isFile()) return false;
        const relative = path.relative(root, realpathSync(absolute));
        return (
          relative !== "" &&
          !relative.startsWith(`..${path.sep}`) &&
          relative !== ".." &&
          !path.isAbsolute(relative)
        );
      } catch {
        return false;
      }
    })
    .sort();
}

export function runSourceFormatting(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !["--check", "--write"].includes(argv[0])) {
    console.error("Usage: node scripts/format-source.mjs --check|--write");
    return 2;
  }
  const root = fileURLToPath(new URL("../", import.meta.url));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const tracked = execFileSync(
    "git",
    [
      `--git-dir=${path.join(root, ".git")}`,
      `--work-tree=${root}`,
      "ls-files",
      "-z",
    ],
    { cwd: root, env, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const files = collectSourceFormattingFiles(root, tracked);
  if (!files.length) return 0;
  const require = createRequire(import.meta.url);
  const prettier = path.join(
    path.dirname(require.resolve("prettier/package.json")),
    "bin/prettier.cjs",
  );
  const result = spawnSync(
    process.execPath,
    [prettier, argv[0], "--ignore-unknown", "--", ...files],
    { cwd: root, env, stdio: "inherit" },
  );
  if (result.error) {
    console.error("Source formatter could not start.");
    return 1;
  }
  return result.status ?? 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = runSourceFormatting();
  } catch {
    console.error(
      "Source formatting failed; verify Git and the installed toolchain.",
    );
    process.exitCode = 1;
  }
}
