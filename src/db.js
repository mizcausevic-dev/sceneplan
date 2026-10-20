import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

const SCHEMA = readFileSync(new URL("./schema.sql", import.meta.url), "utf8")

export function openDatabase(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec("PRAGMA foreign_keys = ON")
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA busy_timeout = 5000")
  migrate(db)
  return db
}

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)
  const existing = db.prepare("SELECT id FROM schema_migrations WHERE id = ?").get("001_init")
  if (existing) return
  db.exec("BEGIN IMMEDIATE")
  try {
    db.exec(SCHEMA)
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("001_init", new Date().toISOString())
    db.exec("COMMIT")
  } catch (error) {
    try { db.exec("ROLLBACK") } catch { /* already closed */ }
    throw error
  }
}

export function get(db, sql, ...params) {
  const row = db.prepare(sql).get(...params)
  return row ? { ...row } : null
}

export function all(db, sql, ...params) {
  return db.prepare(sql).all(...params).map((row) => ({ ...row }))
}

export function run(db, sql, ...params) {
  return db.prepare(sql).run(...params)
}

export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE")
  try {
    const result = fn()
    db.exec("COMMIT")
    return result
  } catch (error) {
    try { db.exec("ROLLBACK") } catch { /* rollback after failed commit */ }
    throw error
  }
}
