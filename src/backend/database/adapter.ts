/**
 * Database Adapter — BINANCE AI FUTURES AGENT v0.1
 *
 * Production: PostgreSQL via Neon (DATABASE_URL)
 * Tests/Dev: SQLite via better-sqlite3
 *
 * This module provides async query functions that work with both backends.
 * Repository code imports these functions instead of getDatabase().
 */

import { createRequire } from "module";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "../logger";

// ESM-safe CommonJS loader for native modules (require is unavailable in
// Vite SSR / module runners). better-sqlite3 is a native CJS addon.
const nodeRequire = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

// ─── PostgreSQL Connection (Lazy Singleton) ─────────────────────────

let pgSql: any = null;
let pgConnected = false;

/**
 * Phase 3.8-B.4-FIX — Safe error categorization for Postgres connect failures.
 * Returns a category only; NEVER includes connection-string contents.
 */
export type DbConnectErrorCategory =
  | "DNS"
  | "TCP_CONNECT_TIMEOUT"
  | "TLS"
  | "AUTH"
  | "CONNECTION_REFUSED"
  | "CONNECTION_LIMIT"
  | "POOLER"
  | "MALFORMED_URL"
  | "UNKNOWN";

/** Strip anything that could carry credentials from an error string. */
function sanitizeErrorText(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "<redacted-connection-string>")
    .replace(/password=[^\s&"]*/gi, "password=<redacted>");
}

export function categorizeDbConnectError(err: unknown): DbConnectErrorCategory {
  const code = (err as { code?: string })?.code ?? "";
  const message = String((err as Error)?.message ?? err);
  const text = `${code} ${message}`.toUpperCase();

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS";
  if (code === "ECONNREFUSED") return "CONNECTION_REFUSED";
  if (text.includes("CONNECT_TIMEOUT") || code === "ETIMEDOUT" || text.includes("ETIMEDOUT"))
    return "TCP_CONNECT_TIMEOUT";
  if (code === "ECONNRESET" || text.includes("SOCKET HANG UP")) return "POOLER";
  if (
    code.startsWith("ERR_TLS") ||
    code === "EPROTO" ||
    text.includes("SSL") ||
    text.includes("TLS")
  )
    return "TLS";
  if (code === "28P01" || code === "28000" || text.includes("PASSWORD AUTHENTICATION"))
    return "AUTH";
  if (code === "53300" || text.includes("TOO MANY CONNECTIONS")) return "CONNECTION_LIMIT";
  if (code === "08006" || code === "57P01") return "POOLER";
  if (text.includes("MALFORMED") || text.includes("INVALID CONNECTION STRING") || text.includes("COULD NOT PARSE"))
    return "MALFORMED_URL";
  return "UNKNOWN";
}

const PG_CONNECT_MAX_ATTEMPTS = 3;
const PG_CONNECT_BACKOFF_BASE_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPostgresConnection(): Promise<any> {
  if (pgSql) return pgSql;

  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL not set — cannot use PostgreSQL");
  }

  const postgres = (await import("postgres")).default;
  pgSql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: { rejectUnauthorized: false },
    // Neon pooler (PgBouncer transaction mode) is not reliably compatible
    // with named prepared statements — use unnamed statements.
    prepare: false,
  });

  // Bounded retry with linear backoff on the initial SELECT 1 health check.
  // Transient cold-start/pooler hiccups (e.g. write CONNECT_TIMEOUT) are
  // retried; a persistent failure still throws (fail-closed).
  let lastError: unknown;
  for (let attempt = 1; attempt <= PG_CONNECT_MAX_ATTEMPTS; attempt++) {
    try {
      await pgSql`SELECT 1`;
      pgConnected = true;
      logger.info("database", "PostgreSQL connected via Neon");
      return pgSql;
    } catch (err) {
      lastError = err;
      pgConnected = false;
      const category = categorizeDbConnectError(err);
      const safeMessage = sanitizeErrorText(String((err as Error)?.message ?? err));
      logger.error(
        "database",
        `PostgreSQL SELECT 1 failed (attempt ${attempt}/${PG_CONNECT_MAX_ATTEMPTS}, category=${category}, DATABASE_URL=SET): ${safeMessage}`,
      );
      if (attempt < PG_CONNECT_MAX_ATTEMPTS) {
        await sleep(PG_CONNECT_BACKOFF_BASE_MS * attempt);
      }
    }
  }

  // Fail-closed: tear down the broken client so a later call can rebuild it.
  try {
    await pgSql.end({ timeout: 5 });
  } catch {
    /* ignore teardown errors */
  }
  pgSql = null;

  const category = categorizeDbConnectError(lastError);
  const safeMessage = sanitizeErrorText(String((lastError as Error)?.message ?? lastError));
  throw new Error(
    `PostgreSQL connection failed after ${PG_CONNECT_MAX_ATTEMPTS} attempts (category=${category}): ${safeMessage}`,
  );
}

// ─── SQLite Connection (Lazy Singleton) ─────────────────────────────

let sqliteDb: any = null;

function getSqliteConnection(): any {
  if (sqliteDb) return sqliteDb;

  const Database = nodeRequire("better-sqlite3");

  const DEFAULT_DB_PATH = join(process.cwd(), "data", "agent.db");
  const dbPath = process.env["DATABASE_PATH"] || DEFAULT_DB_PATH;
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  sqliteDb = new Database(dbPath);
  sqliteDb.pragma("journal_mode = WAL");
  sqliteDb.pragma("foreign_keys = ON");
  sqliteDb.pragma("busy_timeout = 5000");

  // Initialize schema
  const schemaPath = join(here, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  sqliteDb.exec(schema);

  sqliteDb.prepare(`
    INSERT OR REPLACE INTO system_config (key, value, description, updated_at)
    VALUES ('schema_version', '1', 'Database schema version', datetime('now'))
  `).run();

  return sqliteDb;
}

// ─── Public Query Functions ─────────────────────────────────────────

/**
 * Query multiple rows.
 * Uses PostgreSQL when DATABASE_URL is set, SQLite otherwise.
 */
export async function dbQuery(
  sql: string,
  params: unknown[] = []
): Promise<Record<string, unknown>[]> {
  if (process.env["DATABASE_URL"]) {
    const pg = await getPostgresConnection();
    const result = await pg.unsafe(sql, params);
    return result as unknown as Record<string, unknown>[];
  }
  const db = getSqliteConnection();
  return db.prepare(convertPlaceholders(sql)).all(...params);
}

/**
 * Query a single row.
 */
export async function dbQueryOne(
  sql: string,
  params: unknown[] = []
): Promise<Record<string, unknown> | undefined> {
  if (process.env["DATABASE_URL"]) {
    const pg = await getPostgresConnection();
    const result = await pg.unsafe(sql, params);
    return (result as unknown as Record<string, unknown>[])[0];
  }
  const db = getSqliteConnection();
  return db.prepare(convertPlaceholders(sql)).get(...params) as Record<string, unknown> | undefined;
}

/**
 * Convert PostgreSQL $1, $2 placeholders to SQLite ? placeholders.
 */
function convertPlaceholders(sql: string): string {
  // SQLite uses ? for positional parameters, PostgreSQL uses $1, $2, etc.
  return sql.replace(/\$(\d+)/g, '?');
}

/**
 * Execute a mutation (INSERT/UPDATE/DELETE).
 */
export async function dbExecute(
  sql: string,
  params: unknown[] = []
): Promise<void> {
  if (process.env["DATABASE_URL"]) {
    const pg = await getPostgresConnection();
    await pg.unsafe(sql, params);
    return;
  }
  const db = getSqliteConnection();
  db.prepare(convertPlaceholders(sql)).run(...params);
}

/**
 * Execute a mutation and return the number of affected rows.
 */
export async function dbExecuteAndCount(
  sql: string,
  params: unknown[] = []
): Promise<number> {
  if (process.env["DATABASE_URL"]) {
    const pg = await getPostgresConnection();
    const result = await pg.unsafe(sql, params);
    return result.count ?? 0;
  }
  const db = getSqliteConnection();
  const result = db.prepare(convertPlaceholders(sql)).run(...params);
  return result.changes;
}

/**
 * Run a function inside a database transaction.
 */
export async function dbTransaction<T>(
  fn: () => Promise<T>
): Promise<T> {
  if (process.env["DATABASE_URL"]) {
    const pg = await getPostgresConnection();
    return await pg.begin(async (tx: any) => {
      // Execute all queries within this transaction
      return await fn();
    });
  }
  const db = getSqliteConnection();
  const tx = db.transaction(() => fn());
  return await tx();
}

/**
 * Close all database connections.
 */
export async function closeDatabase(): Promise<void> {
  if (pgSql) {
    await pgSql.end();
    pgSql = null;
    pgConnected = false;
    logger.info("database", "PostgreSQL connection closed");
  }
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
    logger.info("database", "SQLite connection closed");
  }
}

/**
 * Check if PostgreSQL is configured.
 */
export function isPostgresConfigured(): boolean {
  return !!process.env["DATABASE_URL"];
}

/**
 * Get a synchronous SQLite database for tests.
 * This bypasses the adapter and directly creates an in-memory SQLite database.
 */
export function createTestDatabase(): any {
  const Database = nodeRequire("better-sqlite3");

  const testDb = new Database(":memory:");
  testDb.pragma("foreign_keys = ON");

  const schemaPath = join(here, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  testDb.exec(schema);

  return testDb;
}

// ─── Legacy Compatibility ───────────────────────────────────────────

/**
 * Get a synchronous database handle.
 * DEPRECATED: Use dbQuery/dbExecute for new code.
 * Only works for SQLite (tests/dev).
 */
export function getDatabase(): any {
  if (process.env["DATABASE_URL"]) {
    throw new Error(
      "Synchronous getDatabase() not available in production. Use dbQuery/dbExecute."
    );
  }
  return getSqliteConnection();
}

// ─── Graceful Shutdown ──────────────────────────────────────────────

if (typeof process !== "undefined") {
  process.on("exit", () => {
    if (sqliteDb) sqliteDb.close();
  });
  process.on("SIGINT", async () => {
    await closeDatabase();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await closeDatabase();
    process.exit(0);
  });
}
