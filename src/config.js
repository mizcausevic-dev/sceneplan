import path from "node:path"

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"])

export function resolveConfig(env = process.env, cwd = process.cwd()) {
  const host = env.HOST || "127.0.0.1"
  const port = Number(env.PORT || 4173)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer from 0 to 65535. 0 asks the operating system for a free port.")
  }
  const dataDir = path.resolve(cwd, env.DATA_DIR || "data")
  return {
    host,
    port,
    dataDir,
    dbPath: path.join(dataDir, "sceneplan.sqlite"),
    uploadDir: path.join(dataDir, "uploads"),
    loopback: LOOPBACK.has(host),
  }
}
