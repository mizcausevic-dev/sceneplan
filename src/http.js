import { createServer } from "node:http"
import { getRequestListener } from "@hono/node-server"
import { requestTooLarge } from "./security.js"

export function createHttpServer(app) {
  const listener = getRequestListener(app.fetch)
  return createServer((req, res) => {
    const method = req.method || "GET"
    const url = req.url || "/"
    if (requestTooLarge(method, url, req.headers["content-length"])) {
      const missing = req.headers["content-length"] == null
      const status = missing ? 411 : 413
      const message = missing
        ? "Content-Length is required."
        : "Request is larger than the limit for this action."
      res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" })
      res.end(message)
      return
    }
    listener(req, res)
  })
}
