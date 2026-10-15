import { createTuiWorker } from "../../src/cli/tui-worker"
import { withTimeout } from "../../src/util/timeout"

const mode = process.argv[2]
if (mode !== "compatibility" && mode !== "native") throw new Error("Expected explicit worker mode")
const worker = createTuiWorker(new URL("./tui-worker-environment-worker.ts", import.meta.url), mode)
try {
  const environment = await withTimeout(
    new Promise<unknown>((resolve, reject) => {
      worker.onmessage = (event) => resolve(event.data)
      worker.onerror = (event) => reject(new Error(event.message))
    }),
    4000,
    "Worker did not report its environment",
  )
  console.log(JSON.stringify({ environment, parentNative: process.env.APEXO_NATIVE_TUI_HOST }))
} finally {
  worker.terminate()
}
