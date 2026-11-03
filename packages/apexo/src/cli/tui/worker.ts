import { EventEmitter } from "node:events"
import { tuiWorkerMode } from "../tui-worker"

EventEmitter.defaultMaxListeners = Math.max(EventEmitter.defaultMaxListeners, 100)

// Keep the compiled worker entry stable while selecting the owned backend before
// importing compatibility services. The parent supplies this private startup flag.
export type { rpc } from "./worker-compatibility"

const queue: MessageEvent[] = []
onmessage = (evt) => {
  queue.push(evt)
}

if (tuiWorkerMode() === "native") await import("./worker-native")
else await import("./worker-compatibility")

for (const evt of queue) {
  onmessage?.call(globalThis as unknown as Window, evt)
}
