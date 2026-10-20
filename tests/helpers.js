import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { openDatabase } from "../src/db.js"

export function tempApp() {
  const dir = mkdtempSync(path.join(tmpdir(), "sceneplan-"))
  const db = openDatabase(path.join(dir, "sceneplan.sqlite"))
  const uploadDir = path.join(dir, "uploads")
  return {
    dir,
    db,
    uploadDir,
    close() {
      try { db.close() } catch { /* already closed */ }
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
