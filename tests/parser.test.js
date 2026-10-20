import assert from "node:assert/strict"
import test from "node:test"
import { decodeScriptBuffer, parseScript } from "../src/parse-script.js"

const SAMPLE = `Title: Unassigned

This stays.

1 INT. KITCHEN - DAY
Ada fills the kettle.

EXT. alley - Night #2#
Wind.

INT/EXT. CAR - DUSK
They argue.

not a heading
INT
This line is not a heading.
`

test("recognizes the documented heading subset and keeps the preamble", () => {
  const parsed = parseScript(SAMPLE)
  assert.equal(parsed.scenes.length, 3)
  assert.match(parsed.preamble, /Unassigned/)
  assert.equal(parsed.scenes[0].displayNumber, "1")
  assert.equal(parsed.scenes[0].intExt, "INT")
  assert.equal(parsed.scenes[0].locationName, "KITCHEN")
  assert.equal(parsed.scenes[0].storyTime, "DAY")
  assert.match(parsed.scenes[0].scriptText, /kettle/)
  assert.equal(parsed.scenes[1].displayNumber, "2")
  assert.equal(parsed.scenes[1].intExt, "EXT")
  assert.equal(parsed.scenes[1].locationName, "alley")
  assert.equal(parsed.scenes[1].storyTime, "Night")
  assert.equal(parsed.scenes[2].intExt, "INT_EXT")
  assert.equal(parsed.scenes[2].heading, "INT/EXT. CAR - DUSK")
  assert.ok(parsed.warnings.some((warning) => warning.code === "malformed-heading"))
})

test("keeps text when no heading matches and does not invent a scene", () => {
  const parsed = parseScript("Just action.\nNo slugline.")
  assert.equal(parsed.scenes.length, 0)
  assert.match(parsed.preamble, /Just action/)
  assert.ok(parsed.warnings.some((warning) => warning.code === "no-scenes"))
})

test("rejects empty, invalid encoding, and oversized input", () => {
  assert.throws(() => parseScript("   "), /empty/)
  assert.throws(() => decodeScriptBuffer(Buffer.from([0xff, 0xfe, 0x41, 0x00])), /UTF-16/)
  assert.throws(() => decodeScriptBuffer(Buffer.from([0x80, 0x80])), /UTF-8/)
  assert.throws(() => decodeScriptBuffer(Buffer.from("hello"), "script.docx"), /txt/)
  const big = Buffer.alloc(512 * 1024 + 1, 0x41)
  assert.throws(() => decodeScriptBuffer(big, "big.txt"), /larger/)
})

test("strips a UTF-8 BOM and preserves the rest of the text", () => {
  const text = decodeScriptBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("INT. ROOM - DAY\nHi.")]), "a.txt")
  assert.equal(text.startsWith("INT."), true)
  const parsed = parseScript(text)
  assert.equal(parsed.scenes[0].locationName, "ROOM")
})

test("warns on duplicate display numbers without dropping scenes", () => {
  const parsed = parseScript("INT. A - DAY #1#\nOne.\n\nINT. B - DAY #1#\nTwo.")
  assert.equal(parsed.scenes.length, 2)
  assert.ok(parsed.warnings.some((warning) => warning.code === "duplicate-number"))
})
