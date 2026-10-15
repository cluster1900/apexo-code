export * as WorkflowLimits from "./limits"

export const scratchFiles = 64
export const scratchBytes = 16_000_000
export const fileBytes = 1_000_000
export const hostCalls = 10_000
export const journalBytes = 16_000_000
export const valueBytes = 1_000_000

export function bytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value) ?? "null")
}

export function journal(calls: readonly unknown[]) {
  if (calls.length > hostCalls || bytes(calls) > journalBytes)
    throw new Error("Workflow host-call journal capacity exceeded")
}

export function value(input: unknown) {
  if (bytes(input) > valueBytes) throw new Error("Workflow host value capacity exceeded")
}

/** Reserve the largest accepted receipt before a host operation can have side effects. */
export function admit(calls: readonly unknown[]) {
  if (calls.length >= hostCalls || bytes(calls) + valueBytes + 128 > journalBytes)
    throw new Error("Workflow host-call journal capacity exceeded")
}
