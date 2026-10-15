export * as Tools from "./tools"

import { Context, Effect, Scope } from "effect"
import { Tool } from "./tool"

export interface Interface {
  /** Validate a private scoped registration and publish it synchronously later. */
  readonly prepare: (
    tools: Readonly<Record<string, Tool.AnyTool>>,
  ) => Effect.Effect<() => void, Tool.RegistrationError, Scope.Scope>
  readonly register: (
    tools: Readonly<Record<string, Tool.AnyTool>>,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
}

/** Narrow registration-only Location capability. */
export class Service extends Context.Service<Service, Interface>()("@apexo/v2/Tools") {}
