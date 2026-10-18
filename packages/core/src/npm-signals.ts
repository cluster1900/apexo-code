/**
 * Arborist's reify catches termination signals and defers the real exit to `beforeExit`, which never fires
 * while a server keeps the event loop alive. A SIGTERM sent to `apexo serve` during a plugin/tool install was
 * therefore swallowed forever (BUG-20261018-396). While reify runs, this guard re-raises the signal with the
 * default action once Arborist has run its rollback hook, unless the host installed its own handler.
 */
const signals = ["SIGTERM", "SIGINT", "SIGHUP"] as const

let active = 0
const guards = new Map<string, () => void>()

function install() {
  for (const sig of signals) {
    const guard = () => {
      // Let Arborist's listener (registered after ours) run its rollback callback first.
      setImmediate(() => {
        const others = process.listeners(sig).filter((listener) => listener !== guard)
        if (others.length) return
        process.removeListener(sig, guard)
        process.kill(process.pid, sig)
      })
    }
    guards.set(sig, guard)
    process.prependListener(sig, guard)
  }
}

function uninstall() {
  for (const [sig, guard] of guards) process.removeListener(sig, guard)
  guards.clear()
}

export async function withSignalPassthrough<T>(run: () => Promise<T>): Promise<T> {
  // Only guard when the host has no handler of its own; interactive commands handle signals themselves.
  if (active++ === 0 && signals.every((sig) => process.listeners(sig).length === 0)) install()
  try {
    return await run()
  } finally {
    if (--active === 0) uninstall()
  }
}
