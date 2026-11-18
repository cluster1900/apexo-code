type Disposer = (directory: string) => Promise<void>
const disposers = { resources: new Set<Disposer>(), leases: new Set<Disposer>() }
const pending = new Map<string, Promise<void>>()

export function registerDisposer(disposer: Disposer, phase: keyof typeof disposers = "resources") {
  const group = disposers[phase]
  group.add(disposer)
  return () => {
    group.delete(disposer)
  }
}

export function disposeInstance(directory: string) {
  const running = pending.get(directory)
  if (running) return running
  // Run consumer finalizers before releasing the plugin data leases held by config.
  const dispose = Promise.allSettled([...disposers.resources].map(async (disposer) => disposer(directory)))
    .then(async () => {
      await Promise.allSettled([...disposers.leases].map(async (disposer) => disposer(directory)))
    })
    .finally(() => pending.delete(directory))
  pending.set(directory, dispose)
  return dispose
}
