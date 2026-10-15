// Test-only checkpoint on the real server's notification bus, after EventV2's durable commit.
import path from "node:path"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { Schema } from "effect"
import { GlobalBus } from "../src/bus/global"
import { SessionEvent } from "@apexo/core/session/event"

const marker = path.join(process.env.XDG_STATE_HOME!, "plan-crash-reached.json")
if (!existsSync(marker)) {
  mkdirSync(path.dirname(marker), { recursive: true })
  const park = (checkpoint: object) => {
    writeFileSync(marker, JSON.stringify(checkpoint))
    // The fixture parent kills/reaps this process. Bound the park if that parent fails.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000)
    throw new Error("Plan crash fixture parent did not stop the checkpointed process")
  }
  GlobalBus.on("event", (event) => {
    const stage = process.env.PLAN_CRASH_STAGE
    if (stage === "decision" && event.payload.type === SessionEvent.AgentSwitched.type) {
      const data = Schema.decodeUnknownSync(Schema.toType(SessionEvent.AgentSwitched.data))(event.payload.properties)
      if (data.agent !== "build") return
      return park({ stage, sessionID: data.sessionID })
    }
    if (stage === "tool" && event.payload.type === SessionEvent.Tool.Success.type) {
      const data = Schema.decodeUnknownSync(Schema.toType(SessionEvent.Tool.Success.data))(event.payload.properties)
      if (
        typeof data.structured.message !== "string" ||
        !data.structured.message.startsWith("The user approved the plan at ")
      )
        return
      return park({
        stage,
        sessionID: data.sessionID,
        assistantMessageID: data.assistantMessageID,
        callID: data.callID,
      })
    }
  })
}
