import { mkdirSync } from "node:fs"
import { createApp } from "./app.js"
import { resolveConfig } from "./config.js"
import { openDatabase } from "./db.js"
import { purgeExpiredPreviews } from "./domain.js"
import { createHttpServer } from "./http.js"

const config = resolveConfig()
if (!config.loopback) {
  console.warn("HOST is not a loopback address. Sceneplan has no login. Anyone who can reach this port can change the data.")
}
mkdirSync(config.dataDir, { recursive: true })
mkdirSync(config.uploadDir, { recursive: true })
const db = openDatabase(config.dbPath)
purgeExpiredPreviews(db)
const app = createApp({ db, uploadDir: config.uploadDir })
const server = createHttpServer(app)

server.listen(config.port, config.host, () => {
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : config.port
  console.log(`Sceneplan listening on http://${config.host}:${port}`)
  console.log("Loopback binding is not authentication. This process trusts the local user.")
})
