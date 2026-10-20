export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.name = "HttpError"
    this.status = status
    this.extra = extra
  }
}

export class ValidationError extends HttpError {
  constructor(message, fields = {}) {
    super(400, message, { fields })
    this.name = "ValidationError"
  }
}

export class ConflictError extends HttpError {
  constructor(message = "This page was opened against an older copy. Reload it, then make the change again. Sceneplan did not overwrite the newer edit.") {
    super(409, message)
    this.name = "ConflictError"
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "That record was not found.") {
    super(404, message)
    this.name = "NotFoundError"
  }
}
