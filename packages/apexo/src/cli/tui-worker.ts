export function createTuiWorker(file: string | URL, mode: "compatibility" | "native") {
  return new Worker(file, {
    env: Object.fromEntries(
      Object.entries({ ...process.env, APEXO_NATIVE_TUI_HOST: mode === "native" ? "1" : "0" }).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  })
}

export function tuiWorkerMode() {
  // Pinned Bun can substitute direct process.env.KEY reads from the parent while
  // compiling a worker. Enumerate the actual worker environment at runtime instead.
  return Object.entries(process.env).find(([key]) => key === "APEXO_NATIVE_TUI_HOST")?.[1] === "1"
    ? "native"
    : "compatibility"
}
