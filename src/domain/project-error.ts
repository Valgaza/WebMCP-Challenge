import { ZodError } from "zod";

export type ProjectErrorCode =
  | "INVALID_INPUT"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_NAME_CONFLICT"
  | "HISTORY_NOT_AVAILABLE"
  | "HISTORY_CONFLICT"
  | "HISTORY_CORRUPTED"
  | "PROPOSAL_NOT_FOUND"
  | "PROPOSAL_STALE"
  | "PROPOSAL_EXPIRED"
  | "CONFIRMATION_REQUIRED"
  | "STORAGE_UNAVAILABLE"
  | "STORAGE_QUOTA_EXCEEDED"
  | "STORAGE_WRITE_FAILED";

export class ProjectError extends Error {
  readonly code: ProjectErrorCode;
  readonly fieldPath?: string;
  readonly cause?: unknown;

  constructor(
    code: ProjectErrorCode,
    message: string,
    options: { fieldPath?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "ProjectError";
    this.code = code;
    this.fieldPath = options.fieldPath;
    this.cause = options.cause;
  }
}

export function toProjectError(error: unknown): ProjectError {
  if (error instanceof ProjectError) {
    return error;
  }

  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    return new ProjectError("INVALID_INPUT", firstIssue?.message ?? "Check the project details and try again.", {
      fieldPath: firstIssue?.path.join("."),
      cause: error,
    });
  }

  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new ProjectError(
      "STORAGE_QUOTA_EXCEEDED",
      "Unable to save this project because browser storage is full. Free some storage and try again.",
      { cause: error },
    );
  }

  if (error instanceof DOMException && error.name === "SecurityError") {
    return new ProjectError(
      "STORAGE_UNAVAILABLE",
      "Local project storage is blocked in this browser. Allow site storage and try again.",
      { cause: error },
    );
  }

  return new ProjectError(
    "STORAGE_WRITE_FAILED",
    "Unable to save the project. Your entered details are preserved; try again.",
    { cause: error },
  );
}
