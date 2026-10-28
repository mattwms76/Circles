#!/usr/bin/env node
/**
 * Prints the DB-06 catalog-only provider preflight SQL.
 *
 * This helper intentionally accepts no connection string, reads no .env file,
 * and never connects to PostgreSQL. The parent operator supplies the printed
 * SQL to an approved read-only provider session during a change window.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

if (args.length !== 1 || args[0] !== "--print-sql") {
  console.error("Usage: node scripts/remaining-db06-preflight.mjs --print-sql");
  process.exitCode = 64;
} else {
  const sqlPath = path.join(
    root,
    "operations/remediation/remaining_db06_provider_preflight.sql",
  );
  process.stdout.write(fs.readFileSync(sqlPath, "utf8"));
}
