import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync, statSync, rmSync } from "node:fs"
import path from "node:path"
import { PNG } from "pngjs"
import jpeg from "jpeg-js"
import { LIMITS } from "./limits.js"
import { ValidationError } from "./errors.js"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function assertId(value, label = "id") {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new ValidationError(`Invalid ${label}.`)
  }
  return value
}

export function resolveUploadPath(uploadDir, productionId, storageKey) {
  assertId(productionId, "production id")
  if (!/^[0-9a-f-]{36}\.png$/i.test(storageKey)) {
    throw new ValidationError("Invalid image key.")
  }
  const root = path.resolve(uploadDir)
  const full = path.resolve(root, productionId, storageKey)
  if (!full.startsWith(root + path.sep)) throw new ValidationError("Invalid image path.")
  return full
}

function pngSize(buffer) {
  if (buffer.length < 24) return null
  if (buffer[0] !== 0x89 || buffer.toString("ascii", 1, 4) !== "PNG") return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function jpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null
    const marker = buffer[offset + 1]
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2
      continue
    }
    const length = buffer.readUInt16BE(offset + 2)
    if (length < 2 || offset + 2 + length > buffer.length) return null
    const isSof = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    if (isSof) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
    }
    offset += 2 + length
  }
  return null
}

function rejectHuge(size) {
  if (!size) return
  if (size.width < 1 || size.height < 1) throw new ValidationError("The image has no visible pixels.")
  if (size.width > LIMITS.imageEdge || size.height > LIMITS.imageEdge) {
    throw new ValidationError(`Images must be at most ${LIMITS.imageEdge} pixels on the long edge.`)
  }
  if (size.width * size.height > LIMITS.imagePixels) {
    throw new ValidationError("The image has too many pixels. Use a smaller storyboard frame.")
  }
}

function looksLikeSvg(buffer) {
  const head = buffer.subarray(0, 256).toString("utf8").trim().toLowerCase()
  return head.startsWith("<svg") || head.includes("<svg") || head.startsWith("<?xml")
}

export function transcodeStoryboard(buffer, originalName = "") {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer)
  if (buffer.length === 0) throw new ValidationError("The image file is empty.")
  if (buffer.length > LIMITS.imageBytes) {
    throw new ValidationError("The image is larger than 5 MB.")
  }
  const lower = String(originalName || "").toLowerCase()
  if (lower.endsWith(".svg") || lower.endsWith(".html") || lower.endsWith(".js") || lower.endsWith(".exe")) {
    throw new ValidationError("That file type is not allowed. Use a JPEG or PNG storyboard frame.")
  }
  if (looksLikeSvg(buffer) || buffer.subarray(0, 2).toString() === "MZ" || buffer.subarray(0, 4).toString() === "\u007fELF") {
    throw new ValidationError("That file is not a JPEG or PNG image.")
  }
  const pngHeader = pngSize(buffer)
  const jpgHeader = jpegSize(buffer)
  if (!pngHeader && !jpgHeader) {
    throw new ValidationError("Sceneplan accepts JPEG and PNG storyboard frames only.")
  }
  rejectHuge(pngHeader || jpgHeader)

  let decoded
  try {
    if (pngHeader) {
      const png = PNG.sync.read(buffer)
      decoded = { width: png.width, height: png.height, data: png.data }
    } else {
      decoded = jpeg.decode(buffer, {
        useTArray: true,
        formatAsRGBA: true,
        maxResolutionInMP: LIMITS.imagePixels / 1_000_000,
        maxMemoryUsageInMB: 64,
      })
    }
  } catch {
    throw new ValidationError("The image could not be decoded. It was not stored.")
  }
  rejectHuge(decoded)
  if (!decoded.data || decoded.data.length < decoded.width * decoded.height * 4) {
    throw new ValidationError("The image could not be decoded. It was not stored.")
  }
  const png = new PNG({ width: decoded.width, height: decoded.height })
  png.data = Buffer.from(decoded.data.subarray(0, decoded.width * decoded.height * 4))
  const encoded = PNG.sync.write(png)
  return {
    bytes: encoded,
    width: decoded.width,
    height: decoded.height,
    contentType: "image/png",
    storageKey: `${randomUUID()}.png`,
  }
}

export function writeImageFile(uploadDir, productionId, storageKey, bytes) {
  const full = resolveUploadPath(uploadDir, productionId, storageKey)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, bytes, { flag: "wx" })
  return full
}

export function readImageFile(uploadDir, productionId, storageKey) {
  const full = resolveUploadPath(uploadDir, productionId, storageKey)
  if (!existsSync(full)) return null
  return readFileSync(full)
}

export function removeImageFile(uploadDir, productionId, storageKey) {
  const full = resolveUploadPath(uploadDir, productionId, storageKey)
  if (existsSync(full)) unlinkSync(full)
}

export function removeProductionUploads(uploadDir, productionId) {
  assertId(productionId, "production id")
  const root = path.resolve(uploadDir)
  const dir = path.resolve(root, productionId)
  if (!dir.startsWith(root + path.sep)) throw new ValidationError("Invalid image path.")
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

export function listOrphanFiles(uploadDir, knownKeys) {
  if (!existsSync(uploadDir)) return []
  const known = new Set(knownKeys)
  const orphans = []
  for (const entry of readdirSync(uploadDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !UUID.test(entry.name)) continue
    const dir = path.join(uploadDir, entry.name)
    for (const file of readdirSync(dir)) {
      const full = path.join(dir, file)
      if (!statSync(full).isFile()) continue
      const key = `${entry.name}/${file}`
      if (!known.has(key)) orphans.push(full)
    }
  }
  return orphans
}
