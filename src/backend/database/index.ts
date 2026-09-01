/**
 * Database connection and initialization.
 * Uses better-sqlite3 (synchronous SQLite driver).
 *
 * For the long-running trading engine, the DB file is shared
 * via WAL mode so both the dashboard server and engine can
 * access it concurrently.
 */

import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { logger } from "../logger";

let db: Database.Database | null = null;

const CURRENT_SCHEMA_VERSION = 1;

const DEFAULT_DB_PATH = join(process.cwd(), "data", "agent.db");

export function getDbPath(): string {
  return process.env["DATABASE_PATH"] || DEFAULT_DB_PATH;
}

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = getDbPath();
    const dir = dirname(dbPath);

    // Ensure data directory exists
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      logger.info("database", `Created data directory: ${dir}`);
    }

    logger.info("database", `Opening database at ${dbPath}`);

    db = new Database(dbPath);

    // WAL mode allows concurrent reads from the trading engine process
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");

    initializeSchema(db);
  }
  return db;
}

function initializeSchema(database: Database.Database): void {
  // Check current schema version
  let version = 0;
  try {
    const row = database.prepare("SELECT value FROM system_config WHERE key = 'schema_version'").get() as { value: string } | undefined;
    version = parseInt(row?.value || "0", 10);
  } catch {
    // system_config table doesn't exist yet
    version = 0;
  }

  if (version >= CURRENT_SCHEMA_VERSION) {
    logger.info("database", `Schema version ${version} is current`);
    return;
  }

  if (version === 0) {
    // Fresh database — run full schema
    logger.info("database", "Initializing fresh database schema");
    const schemaPath = join(__dirname, "schema.sql");
    const schema = readFileSync(schemaPath, "utf-8");
    database.exec(schema);
    logger.info("database", "Schema initialized successfully");
  } else {
    // Future: run migrations for version > 0
    logger.info("database", `Migrating schema from v${version} to v${CURRENT_SCHEMA_VERSION}`);
    // TODO: Add migration logic here when schema changes
  }

  // Update schema version
  database.prepare(`
    INSERT OR REPLACE INTO system_config (key, value, description, updated_at)
    VALUES ('schema_version', ?, 'Database schema version', datetime('now'))
  `).run(String(CURRENT_SCHEMA_VERSION));

  logger.info("database", `Schema version set to ${CURRENT_SCHEMA_VERSION}`);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info("database", "Database connection closed");
  }
}

/**
 * Get a raw database instance for testing or direct access.
 * Creates a fresh in-memory database each time.
 */
export function createTestDatabase(): Database.Database {
  const testDb = new Database(":memory:");
  testDb.pragma("foreign_keys = ON");

  const schemaPath = join(__dirname, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  testDb.exec(schema);

  return testDb;
}

// Graceful shutdown
if (typeof process !== "undefined") {
  process.on("exit", closeDatabase);
  process.on("SIGINT", () => {
    closeDatabase();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    closeDatabase();
    process.exit(0);
  });
}
