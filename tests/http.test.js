import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { PNG } from "pngjs"
import { createApp } from "../src/app.js"
import { openDatabase } from "../src/db.js"
import { createHttpServer } from "../src/http.js"
import { tempApp } from "./helpers.js"

function pngBuffer() {
  const png = new PNG({ width: 12, height: 8 })
  for (let i = 0; i < 12 * 8; i += 1) {
    png.data[i * 4] = 20
    png.data[i * 4 + 1] = 180
    png.data[i * 4 + 2] = 160
    png.data[i * 4 + 3] = 255
  }
  return PNG.sync.write(png)
}

function openSession() {
  const env = tempApp()
  const app = createApp({ db: env.db, uploadDir: env.uploadDir })
  let cookie = ""

  async function request(urlPath, { method = "GET", form = null, file = null, headers = {} } = {}) {
    const hdrs = { host: "127.0.0.1", ...headers }
    if (cookie) hdrs.cookie = cookie
    let body
    if (file) {
      const data = new FormData()
      for (const [key, value] of Object.entries(file.fields || {})) data.set(key, value)
      data.set(file.field, new File([file.bytes], file.filename, { type: file.type || "application/octet-stream" }))
      body = data
    } else if (form) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(form)) {
        if (Array.isArray(value)) value.forEach((item) => params.append(key, String(item)))
        else if (value != null) params.set(key, String(value))
      }
      body = params
      hdrs["content-type"] = "application/x-www-form-urlencoded"
    }
    const res = await app.request(`http://127.0.0.1${urlPath}`, { method, headers: hdrs, body })
    const setCookie = res.headers.get("set-cookie") || ""
    const token = setCookie.match(/sp_csrf=([a-f0-9]{64})/)
    if (token) cookie = `sp_csrf=${token[1]}`
    const text = await res.text()
    return { status: res.status, text, headers: res.headers, location: res.headers.get("location") }
  }

  return { env, app, request }
}

function csrf(html) {
  const match = html.match(/name="_csrf" value="([a-f0-9]{64})"/)
  assert.ok(match, "csrf field missing")
  return match[1]
}

function hidden(html, name) {
  const match = html.match(new RegExp(`name="${name}" value="([^"]*)"`))
  assert.ok(match, `missing hidden ${name}`)
  return match[1]
}

function fieldNear(html, marker, name) {
  const at = html.indexOf(marker)
  assert.ok(at >= 0, `missing marker ${marker}`)
  const match = html.slice(at, at + 1800).match(new RegExp(`name="${name}" value="([^"]*)"`))
  assert.ok(match, `missing ${name} near ${marker}`)
  return match[1]
}

async function follow(session, response) {
  assert.equal(response.status, 303, response.text)
  return session.request(response.location)
}

test("host allowlist, csrf, and escaped text", async () => {
  const session = openSession()
  try {
    const blocked = await session.app.request("http://evil.example/", { headers: { host: "evil.example" } })
    assert.equal(blocked.status, 400)

    const home = await session.request("/")
    assert.equal(home.status, 200)
    assert.match(home.text, /New production/)
    const token = csrf(home.text)
    const denied = await session.request("/productions", {
      method: "POST",
      form: { name: "No token", timezone: "America/New_York", _csrf: "0".repeat(64) },
    })
    assert.equal(denied.status, 403)

    const cross = await session.request("/productions", {
      method: "POST",
      form: { name: "Cross", timezone: "America/New_York", _csrf: token },
      headers: { origin: "https://evil.example" },
    })
    assert.equal(cross.status, 403)
    const opaque = await session.request("/productions", {
      method: "POST",
      form: { name: "Opaque", timezone: "America/New_York", _csrf: token },
      headers: { origin: "null", "sec-fetch-site": "cross-site" },
    })
    assert.equal(opaque.status, 403)
    const same = await session.request("/productions", {
      method: "POST",
      form: { name: "Opaque same", timezone: "America/New_York", logline: "", notes: "", _csrf: token },
      headers: { origin: "null", "sec-fetch-site": "same-origin" },
    })
    assert.equal(same.status, 303)

    const created = await follow(session, await session.request("/productions", {
      method: "POST",
      form: { name: "Harbor <script>alert(1)</script>", timezone: "America/New_York", logline: "", notes: "", _csrf: token },
    }))
    assert.equal(created.status, 200)
    assert.match(created.text, /Harbor &lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.doesNotMatch(created.text, /<script>alert\(1\)<\/script>/)
    assert.match(created.text, /notice/)
  } finally {
    session.env.close()
  }
})

test("core workflow through HTTP, including conflict, import, schedule, print, and image sharing", async () => {
  const session = openSession()
  try {
    const home = await session.request("/")
    const token = csrf(home.text)
    const created = await follow(session, await session.request("/productions", {
      method: "POST",
      form: { name: "Night Market", timezone: "America/New_York", logline: "A short night.", notes: "notes", _csrf: token },
    }))
    const productionId = created.text.match(/\/productions\/([0-9a-f-]{36})\/delete/)[1]
    assert.match(created.text, /Night Market/)

    const sceneForm = await session.request(`/productions/${productionId}/scenes/new`)
    const sceneToken = csrf(sceneForm.text)
    const scenePage = await follow(session, await session.request(`/productions/${productionId}/scenes`, {
      method: "POST",
      form: {
        _csrf: sceneToken,
        display_number: "1",
        heading: "INT. KITCHEN - NIGHT",
        int_ext: "INT",
        location_id: "",
        new_location_name: "Kitchen",
        story_time_of_day: "NIGHT",
        script_text: "She waits.",
        synopsis: "Waiting.",
        production_notes: "Manual scene.",
        shooting_duration_override_minutes: "",
        new_character_name: "Nia",
      },
    }))
    const sceneId = scenePage.text.match(/\/scenes\/([0-9a-f-]{36})\/print/)[1]
    assert.match(scenePage.text, /INT\. KITCHEN - NIGHT/)
    assert.match(scenePage.text, /planning content/)

    const stale = await session.request(`/productions/${productionId}/scenes/${sceneId}`, {
      method: "POST",
      form: {
        _csrf: csrf(scenePage.text),
        revision: "1",
        display_number: "1",
        heading: "INT. KITCHEN - LATER",
        int_ext: "INT",
        location_id: "",
        story_time_of_day: "NIGHT",
        script_text: "She still waits.",
        synopsis: "Waiting.",
        production_notes: "",
        shooting_duration_override_minutes: "",
      },
    })
    assert.equal(stale.status, 303)
    const conflict = await session.request(`/productions/${productionId}/scenes/${sceneId}`, {
      method: "POST",
      form: {
        _csrf: csrf(scenePage.text),
        revision: "1",
        display_number: "1",
        heading: "INT. KITCHEN - TOO LATE",
        int_ext: "INT",
        story_time_of_day: "NIGHT",
        script_text: "Ignored.",
        synopsis: "",
        production_notes: "",
        shooting_duration_override_minutes: "",
      },
    })
    assert.equal(conflict.status, 409)
    assert.match(conflict.text, /conflict/i)

    const fresh = await session.request(`/productions/${productionId}/scenes/${sceneId}`)
    const orderRevision = hidden(fresh.text, "order_revision")
    const withShot = await follow(session, await session.request(`/productions/${productionId}/scenes/${sceneId}/shots`, {
      method: "POST",
      form: {
        _csrf: csrf(fresh.text),
        order_revision: orderRevision,
        display_label: "1A",
        description: "Wide of the counter.",
        shot_size: "Wide",
        camera_angle: "Eye level",
        camera_movement: "Static",
        lens_note: "",
        shooting_duration_minutes: "8",
        equipment_notes: "",
        planning_status: "planned",
        image_alt: "",
      },
    }))
    assert.match(withShot.text, /1A/)
    const shotId = withShot.text.match(/\/shots\/([0-9a-f-]{36})\/move/)[1]
    const shotRevision = fieldNear(withShot.text, `/shots/${shotId}/image`, "revision")
    const imageToken = csrf(withShot.text)
    const imageBody = pngBuffer()
    const uploaded = await follow(session, await session.request(`/productions/${productionId}/shots/${shotId}/image`, {
      method: "POST",
      file: {
        field: "image",
        filename: "../../<img src=x onerror=alert(1)>.png",
        type: "image/png",
        bytes: imageBody,
        fields: { _csrf: imageToken, revision: shotRevision, image_alt: "Counter, no people." },
      },
    }))
    assert.match(uploaded.text, /Counter, no people\./)
    assert.doesNotMatch(uploaded.text, /<img src=x onerror=alert\(1\)>/)
    const media = uploaded.text.match(/src="(\/media\/[^"]+)"/)[1]
    const mediaRes = await session.request(media)
    assert.equal(mediaRes.status, 200)
    assert.equal(mediaRes.headers.get("content-type"), "image/png")
    assert.equal(mediaRes.headers.get("x-content-type-options"), "nosniff")

    const badImage = await session.request(`/productions/${productionId}/shots/${shotId}/image`, {
      method: "POST",
      file: {
        field: "image",
        filename: "frame.svg",
        type: "image/svg+xml",
        bytes: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
        fields: { _csrf: csrf(uploaded.text), revision: fieldNear(uploaded.text, `/shots/${shotId}/image`, "revision"), image_alt: "nope" },
      },
    })
    assert.equal(badImage.status, 400)

    const duplicated = await follow(session, await session.request(`/productions/${productionId}/shots/${shotId}/duplicate`, {
      method: "POST",
      form: { _csrf: csrf(uploaded.text), order_revision: hidden(uploaded.text, "order_revision") },
    }))
    const shotIds = [...duplicated.text.matchAll(/\/shots\/([0-9a-f-]{36})\/delete/g)].map((match) => match[1])
    assert.equal(new Set(shotIds).size, 2)
    assert.equal([...duplicated.text.matchAll(new RegExp(media.replace("/", "\\/"), "g"))].length >= 2, true)
    const copyId = shotIds.find((id) => id !== shotId)
    const removed = await follow(session, await session.request(`/productions/${productionId}/shots/${copyId}/delete`, {
      method: "POST",
      form: { _csrf: csrf(duplicated.text), order_revision: hidden(duplicated.text, "order_revision") },
    }))
    assert.match(removed.text, new RegExp(media.replaceAll("/", "\\/")))

    const schedule = await session.request(`/productions/${productionId}/schedule`)
    const day = await follow(session, await session.request(`/productions/${productionId}/days`, {
      method: "POST",
      form: {
        _csrf: csrf(schedule.text),
        local_date: "2026-04-18",
        local_start_time: "16:00",
        label: "Main",
        max_planned_duration_minutes: "60",
        notes: "Test day",
      },
    }))
    const dayId = day.text.match(/\/days\/([0-9a-f-]{36})\/print/)[1]
    const assigned = await follow(session, await session.request(`/productions/${productionId}/days/${dayId}/scenes`, {
      method: "POST",
      form: { _csrf: csrf(day.text), order_revision: hidden(day.text, "order_revision"), scene_id: sceneId },
    }))
    assert.match(assigned.text, /16:00/)
    assert.match(assigned.text, /16:08/)
    const again = await session.request(`/productions/${productionId}/days/${dayId}/scenes`, {
      method: "POST",
      form: { _csrf: csrf(assigned.text), order_revision: hidden(assigned.text, "order_revision"), scene_id: sceneId },
    })
    assert.equal(again.status, 400)
    assert.match(again.text, /already assigned/)

    const printed = await session.request(`/productions/${productionId}/days/${dayId}/print/schedule`)
    assert.equal(printed.status, 200)
    assert.match(printed.text, /Night Market/)
    assert.match(printed.text, /America\/New_York/)
    assert.match(printed.text, /16:08/)
    assert.doesNotMatch(printed.text, /<form/)
    assert.doesNotMatch(printed.text, /Move up/)
    const scenePrint = await session.request(`/productions/${productionId}/scenes/${sceneId}/print`)
    assert.match(scenePrint.text, /1A/)
    assert.match(scenePrint.text, /Counter, no people/)
    assert.doesNotMatch(scenePrint.text, /<form/)

    const gap = await session.request(`/productions/${productionId}/days`, {
      method: "POST",
      form: {
        _csrf: csrf(schedule.text),
        local_date: "2026-03-08",
        local_start_time: "02:30",
        label: "Gap",
        max_planned_duration_minutes: "",
        notes: "",
      },
    })
    assert.equal(gap.status, 400)
    assert.match(gap.text, /does not exist/)

    const blockedImport = await session.request(`/productions/${productionId}/import`, {
      method: "POST",
      form: { _csrf: csrf(await (await session.request(`/productions/${productionId}/import`)).text), script_text: "INT. ROOM - DAY\n\nHello.\n" },
    })
    assert.equal(blockedImport.status, 400)
    assert.match(blockedImport.text, /already has scenes/)

    const imported = await follow(session, await session.request("/import", {
      method: "POST",
      form: {
        _csrf: token,
        name: "Imported Night",
        timezone: "America/New_York",
        script_text: "Keep this preamble.\n\nINT. KITCHEN - DAY\n\nAda waits.\n\n12 EXT. STREET - NIGHT\n\nLeo runs.\n",
      },
    }))
    assert.match(imported.text, /Keep this preamble/)
    assert.match(imported.text, /INT\. KITCHEN - DAY/)
    const previewId = imported.text.match(/\/import\/([0-9a-f-]{36})\/commit/)[1]
    const committed = await follow(session, await session.request(`/import/${previewId}/commit`, {
      method: "POST",
      form: {
        _csrf: csrf(imported.text),
        preamble: "Keep this preamble.",
        scene_0_include: "yes",
        scene_0_number: "",
        scene_0_int_ext: "INT",
        scene_0_location: "Kitchen",
        scene_0_time: "DAY",
        scene_0_heading: "INT. KITCHEN - DAY",
        scene_0_text: "Ada waits.",
        scene_1_include: "yes",
        scene_1_number: "12",
        scene_1_int_ext: "EXT",
        scene_1_location: "Street",
        scene_1_time: "NIGHT",
        scene_1_heading: "EXT. STREET - NIGHT",
        scene_1_text: "Leo runs.",
      },
    }))
    assert.match(committed.text, /Imported Night/)
    assert.match(committed.text, /Keep this preamble|INT\. KITCHEN - DAY/)
    const importedId = committed.text.match(/\/productions\/([0-9a-f-]{36})\/delete/)[1]
    const script = await session.request(`/productions/${importedId}/script`)
    const versionHref = script.text.match(/\/script\/([0-9a-f-]{36})/)[1]
    const snapshot = await session.request(`/productions/${importedId}/script/${versionHref}`)
    assert.match(snapshot.text, /Keep this preamble/)
    assert.match(snapshot.text, /Ada waits/)

    const reopened = openDatabase(path.join(session.env.dir, "sceneplan.sqlite"))
    const row = reopened.prepare("SELECT name FROM productions WHERE id = ?").get(productionId)
    assert.equal(row.name, "Night Market")
    reopened.close()
  } finally {
    session.env.close()
  }
})

test("request size gate on the node HTTP server", async () => {
  const env = tempApp()
  const server = createHttpServer(createApp({ db: env.db, uploadDir: env.uploadDir }))
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()
  try {
    const missing = await rawHttp(port, "POST /productions HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
    assert.match(missing, /^HTTP\/1\.1 411/)
    const large = await rawHttp(port, "POST /productions HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 2000000\r\nConnection: close\r\n\r\n")
    assert.match(large, /^HTTP\/1\.1 413/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    env.close()
  }
})

test("production survives a server process restart", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sceneplan-restart-"))
  const first = await startServer(dir)
  try {
    const home = await fetch(`http://127.0.0.1:${first.port}/`)
    const html = await home.text()
    const token = csrf(html)
    const cookie = home.headers.get("set-cookie").match(/sp_csrf=[a-f0-9]{64}/)[0]
    const created = await fetch(`http://127.0.0.1:${first.port}/productions`, {
      method: "POST",
      headers: { host: "127.0.0.1", cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "Restarted", timezone: "America/New_York", logline: "", notes: "", _csrf: token }),
      redirect: "manual",
    })
    assert.equal(created.status, 303)
    const location = created.headers.get("location")
    first.child.kill("SIGTERM")
    await first.exited
    const second = await startServer(dir)
    try {
      const page = await fetch(`http://127.0.0.1:${second.port}${location}`)
      const text = await page.text()
      assert.equal(page.status, 200)
      assert.match(text, /Restarted/)
    } finally {
      second.child.kill("SIGTERM")
      await second.exited
    }
  } finally {
    if (first.child.exitCode == null) first.child.kill("SIGTERM")
  }
})

function rawHttp(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(payload))
    let data = ""
    socket.on("data", (chunk) => { data += chunk })
    socket.on("end", () => resolve(data))
    socket.on("error", reject)
  })
}

test("reorder conflict, blocked character delete, and JSON transfer through HTTP", async () => {
  const session = openSession()
  try {
    const home = await session.request("/")
    const token = csrf(home.text)
    const created = await follow(session, await session.request("/productions", {
      method: "POST",
      form: { name: "Reorder", timezone: "America/New_York", logline: "", notes: "", _csrf: token },
    }))
    const productionId = created.text.match(/\/productions\/([0-9a-f-]{36})\/delete/)[1]
    const sceneToken = csrf((await session.request(`/productions/${productionId}/scenes/new`)).text)
    const scenePage = await follow(session, await session.request(`/productions/${productionId}/scenes`, {
      method: "POST",
      form: {
        _csrf: sceneToken,
        display_number: "1",
        heading: "INT. HALL - DAY",
        int_ext: "INT",
        new_character_name: "Nia",
        story_time_of_day: "DAY",
        script_text: "She walks.",
        synopsis: "",
        production_notes: "",
        shooting_duration_override_minutes: "",
      },
    }))
    const sceneId = scenePage.text.match(/\/scenes\/([0-9a-f-]{36})\/print/)[1]
    let page = scenePage
    for (const label of ["1A", "1B"]) {
      page = await follow(session, await session.request(`/productions/${productionId}/scenes/${sceneId}/shots`, {
        method: "POST",
        form: {
          _csrf: csrf(page.text),
          order_revision: hidden(page.text, "order_revision"),
          display_label: label,
          description: label,
          shot_size: "Wide",
          camera_angle: "",
          camera_movement: "",
          lens_note: "",
          shooting_duration_minutes: "3",
          equipment_notes: "",
          planning_status: "planned",
          image_alt: "",
        },
      }))
    }
    const shotId = page.text.match(/\/shots\/([0-9a-f-]{36})\/move/)[1]
    const conflict = await session.request(`/productions/${productionId}/shots/${shotId}/move`, {
      method: "POST",
      form: { _csrf: csrf(page.text), direction: "down", order_revision: "1" },
    })
    assert.equal(conflict.status, 409)

    const people = await session.request(`/productions/${productionId}/people`)
    const characterId = people.text.match(/\/people\/([0-9a-f-]{36})/)[1]
    const blocked = await session.request(`/productions/${productionId}/people/${characterId}/delete`, {
      method: "POST",
      form: { _csrf: csrf(people.text), revision: hidden(people.text, "revision") },
    })
    assert.equal(blocked.status, 400)
    assert.match(blocked.text, /Remove Nia/)

    const other = await follow(session, await session.request("/productions", {
      method: "POST",
      form: { name: "Other", timezone: "America/New_York", logline: "", notes: "", _csrf: token },
    }))
    const otherId = other.text.match(/\/productions\/([0-9a-f-]{36})\/delete/)[1]
    const crossed = await session.request(`/productions/${otherId}/people/${characterId}`, {
      method: "POST",
      form: { _csrf: csrf(other.text), revision: "1", name: "Stolen", notes: "" },
    })
    assert.equal(crossed.status, 404)

    const exported = await session.request(`/productions/${productionId}/export.json`)
    assert.equal(exported.status, 200)
    assert.match(exported.text, /"includesImageFiles": false/)
    const payload = JSON.parse(exported.text)
    payload.production.name = "Reorder copy"
    const review = await follow(session, await session.request("/transfer", {
      method: "POST",
      file: {
        field: "json",
        filename: "transfer.json",
        type: "application/json",
        bytes: Buffer.from(JSON.stringify(payload)),
        fields: { _csrf: token },
      },
    }))
    assert.match(review.text, /Image files are not included/)
    const previewId = review.text.match(/\/transfer\/([0-9a-f-]{36})\/commit/)[1]
    const imported = await follow(session, await session.request(`/transfer/${previewId}/commit`, {
      method: "POST",
      form: { _csrf: csrf(review.text) },
    }))
    assert.match(imported.text, /Reorder copy/)
    const importedId = imported.text.match(/\/productions\/([0-9a-f-]{36})\/delete/)[1]
    assert.notEqual(importedId, productionId)
    assert.match(imported.text, /INT\. HALL - DAY/)
  } finally {
    session.env.close()
  }
})

function startServer(dataDir) {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let output = ""
  const exited = new Promise((resolve) => child.on("exit", resolve))
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not listen\n${output}`)), 8000)
    const onData = (chunk) => {
      output += chunk
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/)
      if (match) {
        clearTimeout(timer)
        resolve(Number(match[1]))
      }
    }
    child.stdout.on("data", onData)
    child.stderr.on("data", onData)
  })
  return ready.then((port) => ({ child, port, exited }))
}
