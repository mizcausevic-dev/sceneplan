import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { openDatabase } from "../src/db.js"
import { dayView, listScenes, productionWarnings } from "../src/domain.js"

function runSeed(dataDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "scripts/seed.js"], {
      cwd: process.cwd(),
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", (chunk) => { output += chunk })
    child.stderr.on("data", (chunk) => { output += chunk })
    child.on("exit", (code) => {
      if (code === 0) resolve(output)
      else reject(new Error(output))
    })
  })
}

test("seed creates the fictional production once and shows planning warnings", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sceneplan-seed-"))
  const first = await runSeed(dir)
  assert.match(first, /Seeded fictional production/)
  const second = await runSeed(dir)
  assert.match(second, /Seed already present/)
  const db = openDatabase(path.join(dir, "sceneplan.sqlite"))
  try {
    const productions = db.prepare("SELECT * FROM productions").all()
    assert.equal(productions.length, 1)
    assert.equal(productions[0].name, "Paper Boats on Mercer Street")
    assert.match(productions[0].notes, /Fictional demonstration/)
    const scenes = listScenes(db, productions[0].id)
    assert.equal(scenes.length, 5)
    const shots = db.prepare("SELECT COUNT(*) AS c FROM shots").get().c
    assert.equal(shots, 15)
    const images = db.prepare("SELECT COUNT(*) AS c FROM storyboard_images").get().c
    assert.equal(images, 1)
    const shared = db.prepare("SELECT COUNT(*) AS c FROM shots WHERE storyboard_image_id IS NOT NULL").get().c
    assert.equal(shared, 2)
    const day = db.prepare("SELECT id FROM shoot_days").get()
    const view = dayView(db, day.id)
    assert.equal(view.calc.status, "valid")
    assert.equal(view.calc.items[0].startLabel, "16:00")
    assert.equal(view.calc.items.at(-1).endLabel, "19:39")
    const warnings = productionWarnings(db, productions[0].id)
    assert.ok(warnings.some((item) => item.code === "unscheduled"))
    assert.ok(view.calc.items.some((item) => item.durationSource === "override"))
  } finally {
    db.close()
  }
})
