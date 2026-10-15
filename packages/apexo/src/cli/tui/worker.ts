import { tuiWorkerMode } from "../tui-worker"

// Keep the compiled worker entry stable while selecting the owned backend before
// importing compatibility services. The parent supplies this private startup flag.
export type { rpc } from "./worker-compatibility"

if (tuiWorkerMode() === "native") await import("./worker-native")
else await import("./worker-compatibility")
