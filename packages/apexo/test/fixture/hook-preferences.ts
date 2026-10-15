import { Effect } from "effect"
import { HookPreferences } from "@apexo/core/hook-preferences"

// Pure registry/dispatch fixtures deliberately supply an empty preference capability.
// Tests of persisted choices use the real store instead.
export const emptyHookSelection: HookPreferences.Selection = () => ({ disabled: [] })
export const emptyHookPreferences: HookPreferences.Store = {
  read: Effect.succeed({ disabled: [] }),
  change: () => Effect.die("This pure fixture does not implement preference mutations"),
}
