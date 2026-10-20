const ESCAPE = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPE[ch])
}

function mark(content) {
  return { __safe: true, content }
}

function interpolate(value) {
  if (value == null || value === false) return ""
  if (Array.isArray(value)) return value.map(interpolate).join("")
  if (typeof value === "object" && value.__safe) return value.content
  return escapeHtml(value)
}

export function html(strings, ...values) {
  let out = strings[0]
  for (let i = 0; i < values.length; i += 1) {
    out += interpolate(values[i])
    out += strings[i + 1]
  }
  return mark(out)
}

export function raw(content) {
  return mark(String(content))
}

export function render(value) {
  if (value && typeof value === "object" && value.__safe) return value.content
  return String(value ?? "")
}
