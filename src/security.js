import { randomBytes, timingSafeEqual } from "node:crypto"
import { getCookie, setCookie } from "hono/cookie"
import { HttpError } from "./errors.js"
import { scalar } from "./forms.js"

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost"])

export function requestTooLarge(method, url, contentLength) {
  if (method === "GET" || method === "HEAD") return false
  const path = url.split("?")[0]
  let max = 1_000_000
  if (path.endsWith("/image")) max = 5_500_000
  else if (path.endsWith("/import/json") || path.includes("/transfer")) max = 1_700_000
  else if (path.endsWith("/import") || path.includes("/import/")) max = 1_200_000
  if (contentLength == null) return true
  return Number(contentLength) > max
}

export function assertAllowedHost(hostHeader) {
  if (!hostHeader || hostHeader.includes("@") || hostHeader.includes("\\")) return false
  const hostname = hostHeader.startsWith("[") ? "" : hostHeader.split(":")[0]
  return ALLOWED_HOSTS.has(hostname)
}

function tokensEqual(left, right) {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function securityMiddleware() {
  return async (c, next) => {
    const host = c.req.header("host") || ""
    if (!assertAllowedHost(host)) {
      return c.text("Sceneplan only accepts requests for localhost or 127.0.0.1.", 400)
    }
    let token = getCookie(c, "sp_csrf")
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      token = randomBytes(32).toString("hex")
      setCookie(c, "sp_csrf", token, {
        httpOnly: true,
        sameSite: "Strict",
        path: "/",
        secure: false,
      })
    }
    c.set("csrf", token)
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const origin = c.req.header("origin")
      const site = c.req.header("sec-fetch-site")
      if (origin && origin !== "null") {
        let parsed
        try { parsed = new URL(origin) } catch { return c.text("Cross-origin request blocked.", 403) }
        if (parsed.host !== host || !assertAllowedHost(parsed.host)) {
          return c.text("Cross-origin request blocked.", 403)
        }
      } else if (site && site !== "same-origin" && site !== "none") {
        return c.text("Cross-origin request blocked.", 403)
      }
    }
    await next()
    c.header("X-Content-Type-Options", "nosniff")
    c.header("Referrer-Policy", "no-referrer")
    c.header("X-Frame-Options", "DENY")
    c.header("Content-Security-Policy", "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'")
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if (!c.res.headers.get("Cache-Control")) c.header("Cache-Control", "no-store")
  }
}

export function assertCsrf(c, body) {
  const cookie = getCookie(c, "sp_csrf") || ""
  const token = String(scalar(body, "_csrf") || c.req.header("x-sceneplan-csrf") || "")
  if (!tokensEqual(cookie, token)) {
    throw new HttpError(403, "The request failed the cross-site check. Reload the page and try again.")
  }
}
