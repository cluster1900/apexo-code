import type { MemoryCaptureActivity } from "@apexo/sdk/v2"
import stripAnsi from "strip-ansi"

export function memoryCaptureText(info: MemoryCaptureActivity["data"]) {
  const labels = {
    queued: "queued",
    running: "running",
    completed: "completed",
    no_op: "no new memories",
    retry: "retrying",
    failed: "failed",
  }
  return stripAnsi(
    [
      `Memory capture: ${labels[info.activity]} · turns ${info.fromTurn}–${info.throughTurn} · attempt ${info.attempt}`,
      ...(info.memories ?? []).flatMap((entry) => [entry.statement, ...(entry.body ? [entry.body] : []), entry.path]),
    ].join("\n"),
  ).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
}
