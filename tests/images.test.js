import assert from "node:assert/strict"
import test from "node:test"
import { PNG } from "pngjs"
import { transcodeStoryboard, resolveUploadPath } from "../src/images.js"
import { randomUUID } from "node:crypto"

function pngBuffer(width, height, pixel = [20, 40, 60, 255]) {
  const png = new PNG({ width, height })
  for (let i = 0; i < width * height; i += 1) {
    png.data[i * 4] = pixel[0]
    png.data[i * 4 + 1] = pixel[1]
    png.data[i * 4 + 2] = pixel[2]
    png.data[i * 4 + 3] = pixel[3]
  }
  return PNG.sync.write(png)
}

test("re-encodes a PNG and rejects unsafe or undecodable uploads", () => {
  const stored = transcodeStoryboard(pngBuffer(12, 8), "frame.png")
  assert.equal(stored.contentType, "image/png")
  assert.equal(stored.width, 12)
  assert.equal(stored.height, 8)
  assert.match(stored.storageKey, /^[0-9a-f-]{36}\.png$/)
  assert.equal(stored.bytes[0], 0x89)

  assert.throws(() => transcodeStoryboard(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "x.svg"), /not allowed|JPEG and PNG/)
  assert.throws(() => transcodeStoryboard(Buffer.from("not an image"), "x.png"), /JPEG and PNG/)
  assert.throws(() => transcodeStoryboard(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("broken")]), "x.jpg"), /decoded|JPEG and PNG/)
  assert.throws(() => transcodeStoryboard(Buffer.alloc(5 * 1024 * 1024 + 1, 1), "big.png"), /5 MB/)
  assert.throws(() => transcodeStoryboard(pngBuffer(5000, 10), "wide.png"), /4096/)
})

test("refuses storage keys that escape the upload directory", () => {
  const id = randomUUID()
  assert.throws(() => resolveUploadPath("/tmp/sceneplan-uploads", id, "../secrets.png"), /Invalid image/)
  const safe = resolveUploadPath("/tmp/sceneplan-uploads", id, `${id}.png`)
  assert.equal(safe.endsWith(`${id}.png`), true)
})
