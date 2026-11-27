export type ErrorCode = "invalid_input" | "not_found" | "conflict" | "rule_violation" | "duplicate" | "forbidden" | "unknown_op";

const STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  forbidden: 403,
  not_found: 404,
  unknown_op: 404,
  conflict: 409,
  duplicate: 409,
  rule_violation: 422,
};

/** An expected failure with a stable code; the API turns it into a JSON error response. */
export class OpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
    this.status = STATUS[code];
  }
}
