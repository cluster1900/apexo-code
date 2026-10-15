export * as SessionChildPlacementAccess from "./child-placement-access"

import { Context, Effect, Schema } from "effect"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { CommandSandbox } from "../command-sandbox"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { SessionRunnerModel } from "./runner/model"
import { SessionSchema } from "./schema"

export class Failure extends Schema.TaggedErrorClass<Failure>()("SessionChildPlacement.Failure", {
  message: Schema.String,
}) {}
export type Services =
  | AgentV2.Service
  | Catalog.Service
  | CommandSandbox.Service
  | PermissionV2.Service
  | SessionRunnerModel.Service
export interface Capability {
  readonly parentID: SessionSchema.ID
  readonly inspect: <A, E>(
    location: Location.Ref,
    effect: Effect.Effect<A, E, Services>,
  ) => Effect.Effect<A, E | Failure>
}
/** Only the global Session execution owner supplies cross-Location admission inspection. */
export const Current = Context.Reference<Capability | undefined>("@apexo/SessionChildPlacementAccess", {
  defaultValue: () => undefined,
})
