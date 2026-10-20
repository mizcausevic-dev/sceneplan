import { LIMITS } from "./limits.js"
import { ValidationError } from "./errors.js"

const PREFIX = "INT/EXT|EXT/INT|INT\\./EXT|EXT\\./INT|I/E|INT|EXT|EST"
const HEADING = new RegExp(
  `^\\s*(?:(\\d+[A-Za-z]?)\\s+)?(${PREFIX})\\.?\\s+(.+?)(?:\\s+#([A-Za-z0-9]+)#)?\\s*$`,
  "i",
)
const LOOSE = new RegExp(
  `^\\s*(?:\\d+[A-Za-z]?\\s+)?(?:${PREFIX})\\b`,
  "i",
)

export function decodeScriptBuffer(buffer, filename = "") {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer)
  if (filename && !filename.toLowerCase().endsWith(".txt")) {
    throw new ValidationError("Upload a UTF-8 .txt file. PDF, DOCX, and other formats are not imported.")
  }
  if (buffer.length === 0) throw new ValidationError("The script is empty.")
  if (buffer.length > LIMITS.scriptBytes) {
    throw new ValidationError(`The script is larger than ${LIMITS.scriptBytes} bytes. Split it before importing.`)
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    throw new ValidationError("This file looks like UTF-16. Save it as UTF-8 and try again.")
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    throw new ValidationError("This file looks like UTF-16. Save it as UTF-8 and try again.")
  }
  let offset = 0
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) offset = 3
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(offset))
    if (text.includes("\u0000")) throw new ValidationError("The script contains a null character and was rejected.")
    return text
  } catch (error) {
    if (error instanceof ValidationError) throw error
    throw new ValidationError("The file is not valid UTF-8. Sceneplan did not import it.")
  }
}

function normalizePrefix(raw) {
  const compact = raw.toUpperCase().replace(/\s+/g, "")
  if (compact === "INT") return { code: "INT", label: "INT" }
  if (compact === "EXT") return { code: "EXT", label: "EXT" }
  if (compact === "EST") return { code: "EST", label: "EST" }
  if (compact === "I/E" || compact === "INT/EXT" || compact === "EXT/INT" || compact === "INT./EXT" || compact === "EXT./INT") {
    return { code: "INT_EXT", label: "INT/EXT" }
  }
  return { code: "OTHER", label: compact }
}

function splitLocation(rest) {
  const marker = " - "
  const index = rest.lastIndexOf(marker)
  if (index === -1) return { location: rest.trim(), time: "", timed: false }
  return {
    location: rest.slice(0, index).trim(),
    time: rest.slice(index + marker.length).trim(),
    timed: true,
  }
}

export function parseScript(text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new ValidationError("The script is empty.")
  }
  if (Buffer.byteLength(text, "utf8") > LIMITS.scriptBytes) {
    throw new ValidationError(`The script is larger than ${LIMITS.scriptBytes} bytes. Split it before importing.`)
  }
  const lines = text.split(/\r\n|\n|\r/)
  if (lines.length > LIMITS.scriptLines) {
    throw new ValidationError(`The script has more than ${LIMITS.scriptLines} lines.`)
  }
  for (const line of lines) {
    if (line.length > LIMITS.scriptLineChars) {
      throw new ValidationError(`A line is longer than ${LIMITS.scriptLineChars} characters.`)
    }
  }

  const warnings = []
  const scenes = []
  const preambleLines = []
  let current = null
  let seenHeading = false

  function pushCurrent() {
    if (!current) return
    current.scriptText = current.lines.join("\n").replace(/\s+$/u, "")
    delete current.lines
    scenes.push(current)
    current = null
  }

  lines.forEach((line, index) => {
    const match = HEADING.exec(line)
    if (match) {
      seenHeading = true
      pushCurrent()
      const prefix = normalizePrefix(match[2])
      const split = splitLocation(match[3].trim())
      const leading = match[1] || ""
      const hashed = match[4] || ""
      let displayNumber = hashed || leading
      if (hashed && leading && hashed !== leading) {
        warnings.push({
          code: "number-conflict",
          line: index + 1,
          message: `Line ${index + 1} has two scene numbers (${leading} and #${hashed}#). The preview uses #${hashed}#.`,
        })
        displayNumber = hashed
      }
      if (displayNumber.length > 12) {
        warnings.push({
          code: "number-length",
          line: index + 1,
          message: `Line ${index + 1} has a scene number longer than 12 characters. It was left blank in the preview.`,
        })
        displayNumber = ""
      }
      if (!split.location) {
        warnings.push({
          code: "missing-location",
          line: index + 1,
          message: `Line ${index + 1} has a scene heading without a location. You can fill it in before saving.`,
        })
      }
      if (!split.timed) {
        warnings.push({
          code: "missing-time",
          line: index + 1,
          message: `Line ${index + 1} has no " - TIME" ending. The time-of-day field was left blank.`,
        })
      }
      const heading = split.timed
        ? `${prefix.label}. ${split.location} - ${split.time}`
        : `${prefix.label}. ${split.location}`
      current = {
        displayNumber,
        intExt: prefix.code,
        locationName: split.location,
        storyTime: split.time,
        heading: heading.trim(),
        lines: [],
        sourceLine: index + 1,
      }
      return
    }
    if (!seenHeading) {
      preambleLines.push(line)
      return
    }
    if (LOOSE.test(line)) {
      warnings.push({
        code: "malformed-heading",
        line: index + 1,
        message: `Line ${index + 1} looks like a scene heading but does not match the supported pattern. It stayed in the scene text.`,
      })
    }
    if (current) current.lines.push(line)
    else preambleLines.push(line)
  })
  pushCurrent()

  if (scenes.length > LIMITS.scriptScenes) {
    throw new ValidationError(`The script has more than ${LIMITS.scriptScenes} scenes. Split the import.`)
  }

  const numbers = new Map()
  for (const scene of scenes) {
    if (!scene.displayNumber) continue
    const list = numbers.get(scene.displayNumber) || []
    list.push(scene.sourceLine)
    numbers.set(scene.displayNumber, list)
  }
  for (const [number, where] of numbers) {
    if (where.length > 1) {
      warnings.push({
        code: "duplicate-number",
        message: `Scene number ${number} appears more than once (lines ${where.join(", ")}). Duplicate display numbers are allowed and were kept.`,
      })
    }
  }

  const preamble = preambleLines.join("\n").replace(/\s+$/u, "")
  if (!scenes.length) {
    warnings.push({
      code: "no-scenes",
      message: "No supported scene headings were found. Nothing was saved. The text is still in this preview so you can add a scene or fix the headings.",
    })
  }

  return { preamble, scenes, warnings }
}
