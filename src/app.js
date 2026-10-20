import { readFileSync } from "node:fs"
import { Hono } from "hono"
import { HttpError } from "./errors.js"
import { register } from "./routes.js"
import { securityMiddleware } from "./security.js"
import { messagePage, page } from "./views.js"

const css = readFileSync(new URL("./public/app.css", import.meta.url))
const clientJs = readFileSync(new URL("./public/app.js", import.meta.url))

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Sceneplan">
  <rect width="32" height="32" fill="#0B0C10"/>
  <rect x="4" y="7" width="24" height="16" fill="none" stroke="#66FCF1" stroke-width="2"/>
  <rect x="8" y="11" width="6" height="8" fill="#45A29E"/>
  <rect x="16" y="11" width="8" height="8" fill="#1F2833" stroke="#C5C6C7"/>
</svg>`

export function createApp({ db, uploadDir }) {
  const app = new Hono()
  app.use("*", securityMiddleware())
  app.get("/assets/app.css", (c) => c.body(css, 200, {
    "content-type": "text/css; charset=utf-8",
    "cache-control": "no-cache",
  }))
  app.get("/assets/app.js", (c) => c.body(clientJs, 200, {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "no-cache",
  }))
  app.get("/favicon.svg", (c) => c.body(FAVICON, 200, {
    "content-type": "image/svg+xml",
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  }))
  app.get("/favicon.ico", (c) => c.body(FAVICON, 200, {
    "content-type": "image/svg+xml",
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  }))
  register(app, { db, uploadDir })
  app.notFound((c) => c.html(page(messagePage("Not found", "That page is not in this Sceneplan workspace.")), 404))
  app.onError((error, c) => {
    if (error instanceof HttpError) {
      const title = error.status === 409 ? "Edit conflict" : "Cannot complete that action"
      return c.html(page(messagePage(title, error.message)), error.status)
    }
    console.error(error)
    return c.html(page(messagePage("Something went wrong", "The last action failed. The previous save was not confirmed.")), 500)
  })
  return app
}
