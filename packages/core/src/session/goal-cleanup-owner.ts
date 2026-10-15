export * as SessionGoalCleanupOwner from "./goal-cleanup-owner"

import { randomUUID } from "node:crypto"

export const current = { pid: process.pid, token: randomUUID() }

/** A reused PID or an inaccessible process is conservatively treated as still alive. */
export function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH")
  }
}
