import { EOL } from "os"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.debug.commands.agents,
  Effect.fn("cli.debug.agents")(function* () {
    const daemon = yield* Daemon.Service
    const client = yield* daemon.client()
    const response = yield* Effect.promise(() => client.v2.agent.list({ location: { directory: process.cwd() } }))
    const items = (response.data?.data ?? [])
      .filter((item) => !item.hidden)
      .map((item) => ({
        id: item.id,
        model: item.model,
        request: item.request,
        description: item.description,
        mode: item.mode,
        hidden: item.hidden,
        color: item.color,
        steps: item.steps,
      }))
      .toSorted((a, b) => a.id.localeCompare(b.id))
    process.stdout.write(JSON.stringify(items, null, 2) + EOL)
  }),
)
