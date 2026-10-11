import type { IngestErrorCode } from "@mri/shared";

/** A rejected input. Carries a stable machine code; the message is safe to show a user. */
export class IngestError extends Error {
  readonly code: IngestErrorCode;

  constructor(code: IngestErrorCode, message: string) {
    super(message);
    this.name = "IngestError";
    this.code = code;
  }
}
