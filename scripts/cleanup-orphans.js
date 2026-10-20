import { unlinkSync } from "node:fs"
import { resolveConfig } from "../src/config.js"
import { openDatabase } from "../src/db.js"
import { knownImageKeys } from "../src/domain.js"
import { listOrphanFiles } from "../src/images.js"

const apply = process.argv.includes("--apply")
const config = resolveConfig()
const db = openDatabase(config.dbPath)
const orphans = listOrphanFiles(config.uploadDir, knownImageKeys(db))

for (const file of orphans) {
  console.log(`${apply ? "delete" : "orphan"} ${file}`)
  if (apply) unlinkSync(file)
}

console.log(`${orphans.length} orphan file(s). ${apply ? "Deleted files that had no storyboard row." : "Dry run. Pass --apply to delete those files."}`)
console.log("A storyboard row whose file is already missing is left in place. The shot page reports the missing file. This script does not delete database rows.")
db.close()
