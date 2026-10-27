/**
 * HttpError — an Error carrying an HTTP status, a machine-readable code and
 * optional field-level details. Thrown from anywhere in the service layer and
 * translated to a JSON response by middleware/errorHandler.js.
 */
"use strict";

class HttpError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} message human-readable message returned to the client
   * @param {object} [options]
   * @param {string} [options.code] machine-readable error code (defaults to a status-derived one)
   * @param {Record<string, unknown>} [options.details] validation details per field
   * @param {Error} [options.cause]
   */
  constructor(status, message, options = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = options.code || defaultCode(status);
    this.details = options.details ?? null;
    this.expose = true;
    if (options.cause) this.cause = options.cause;
    Error.captureStackTrace(this, HttpError);
  }

  static badRequest(message, details) {
    return new HttpError(400, message, { code: "validation_error", details });
  }

  static notFound(message = "Resource not found") {
    return new HttpError(404, message, { code: "not_found" });
  }

  static conflict(message, details) {
    return new HttpError(409, message, { code: "conflict", details });
  }

  static unprocessable(message, details) {
    return new HttpError(422, message, { code: "unprocessable_entity", details });
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

function defaultCode(status) {
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 422:
      return "unprocessable_entity";
    default:
      return "internal_error";
  }
}

module.exports = { HttpError };
