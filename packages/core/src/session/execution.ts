export * as SessionExecution from "./execution"

import { Context, Effect, Layer } from "effect"
import { LayerNode } from "../effect/layer-node"
import { Node } from "../effect/app-node"
import { SessionRunner } from "./runner/index"
import { SessionRunCoordinator } from "./run-coordinator"
import { SessionSchema } from "./schema"

export interface Interface {
  readonly compact: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<void, SessionRunner.CompactError | SessionRunCoordinator.ControlCancelled>
  /** Snapshots active execution owned by this process. */
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly wait: (sessionID: SessionSchema.ID) => Effect.Effect<void, SessionRunner.RunError>
  /** Internal owned control lane; actions must not recursively await this Session's execution. */
  readonly control: <A, E>(
    sessionID: SessionSchema.ID,
    operation: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | SessionRunCoordinator.ControlCancelled>
  /** Starts or joins ordinary Session execution. Managed children require the owning runner capability. */
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, SessionRunner.RunError>
  /** Advises ordinary Session execution of recorded work. Coalesces wakes; never starts managed children. */
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Interrupt active work owned by this process. Idle interruption is a no-op. */
  readonly interrupt: (sessionID: SessionSchema.ID, when?: () => boolean) => Effect.Effect<void>
}

/** Routes execution from a Session ID to the runner owned by that Session's Location. */
export class Service extends Context.Service<Service, Interface>()("@apexo/v2/SessionExecution") {}

export const node = LayerNode.unbound(Service, Node.tags.values.global)

/** Low-level compatibility layer for callers that only need durable Session recording. */
export const noopLayer = Layer.succeed(
  Service,
  Service.of({
    active: Effect.succeed(new Set()),
    compact: () => Effect.fail(new SessionRunCoordinator.ControlCancelled()),
    resume: () => Effect.void,
    wait: () => Effect.void,
    control: () => Effect.fail(new SessionRunCoordinator.ControlCancelled()),
    wake: () => Effect.void,
    interrupt: () => Effect.void,
  }),
)
