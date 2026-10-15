import { tuiWorkerMode } from "../../src/cli/tui-worker"

// Inspect the real worker environment, without Bun's direct-property substitution.
const environment = Object.fromEntries(Object.entries(process.env))
postMessage({
  inherited: environment.APEXO_WORKER_ENV_PROBE,
  empty: environment.APEXO_WORKER_ENV_EMPTY,
  native: environment.APEXO_NATIVE_TUI_HOST,
  mode: tuiWorkerMode(),
})
