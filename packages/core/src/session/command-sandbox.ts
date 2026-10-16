export * as SessionCommandSandbox from "./command-sandbox"

import { and, asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { CommandSandboxPaths } from "../command-sandbox/paths"
import { CommandSandboxPolicy } from "../command-sandbox/policy"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { EventTable } from "../event/sql"
import { SessionV1 } from "../v1/session"
import { SessionCommandSandboxTable } from "./command-sandbox.sql"
import { SessionLifecycle } from "./lifecycle"
import { SessionSchema } from "./schema"
import { SessionTable } from "./sql"

const capability = Symbol("Immutable Session command sandbox")
export interface Capability {
  readonly [capability]: true
}
export type Failure = CommandSandboxPolicy.Failure | SessionLifecycle.Closed
const Parent = Schema.Struct({ sessionID: SessionSchema.ID, createdEventID: Schema.String })
const Stored = Schema.Struct({
  policy: CommandSandboxPolicy.Policy,
  parent: Schema.optional(Parent),
  origin: Schema.optional(Schema.Literal("migration")),
})

export const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const db = database.db
  const lifecycle = yield* SessionLifecycle.Service
  const capabilities = new WeakMap<
    Capability,
    {
      claim: SessionLifecycle.Claim
      created: string
      policy: CommandSandboxPolicy.Policy
      derived?: CommandSandboxPolicy.Policy
    }
  >()
  const failure = (message: string) => new CommandSandboxPolicy.Failure({ code: "identity_conflict", message })
  const storage = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.mapError((error) =>
        error instanceof CommandSandboxPolicy.Failure || error instanceof SessionLifecycle.Closed
          ? error
          : new CommandSandboxPolicy.Failure({
              code: "unavailable",
              message: "The stored command sandbox policy is unavailable.",
            }),
      ),
    )

  const proof = (sessionID: SessionSchema.ID) =>
    storage(
      Effect.gen(function* () {
        const events = yield* db
          .select({ id: EventTable.id, data: EventTable.data })
          .from(EventTable)
          .where(
            and(
              eq(EventTable.aggregate_id, sessionID),
              eq(
                EventTable.type,
                EventV2.versionedType(SessionV1.Event.Created.type, SessionV1.Event.Created.durable!.version),
              ),
            ),
          )
          .orderBy(asc(EventTable.seq))
          .limit(2)
        const event = events.length === 1 ? events[0] : undefined
        if (!event || event.data.sessionID !== sessionID)
          return yield* failure("The Session has no unambiguous creation proof.")
        const data = yield* Schema.decodeUnknownEffect(SessionV1.Event.Created.data)(event.data).pipe(
          Effect.mapError(() => failure("The Session creation proof is invalid.")),
        )
        if (data.info.id !== sessionID) return yield* failure("The Session creation proof has a different identity.")
        return { id: event.id, parentID: data.info.parentID }
      }),
    )

  const read = (sessionID: SessionSchema.ID) =>
    storage(
      Effect.gen(function* () {
        const created = yield* proof(sessionID)
        const row = yield* db
          .select()
          .from(SessionCommandSandboxTable)
          .where(eq(SessionCommandSandboxTable.session_id, sessionID))
          .get()
        if (!row || row.version !== 1 || row.created_event_id !== created.id)
          return yield* failure("The Session has no matching immutable command sandbox policy.")
        const stored = yield* Schema.decodeUnknownEffect(Stored, { onExcessProperty: "error" })(row.policy).pipe(
          Effect.mapError(
            () =>
              new CommandSandboxPolicy.Failure({
                code: "invalid_policy",
                message: "The stored command sandbox policy is invalid.",
              }),
          ),
        )
        const policy = stored.policy
        if (CommandSandboxPolicy.isConfined(policy)) {
          const { revision, ...value } = policy
          if (revision !== CommandSandboxPolicy.revision(value))
            return yield* failure("The stored command sandbox policy revision is invalid.")
        }
        return {
          created: created.id,
          policy: CommandSandboxPolicy.freeze(policy),
          parent: stored.parent,
          origin: stored.origin,
        }
      }),
    )
  const insert = (
    sessionID: SessionSchema.ID,
    created: string,
    policy: CommandSandboxPolicy.Policy,
    parent?: typeof Parent.Type,
  ) =>
    storage(
      db
        .insert(SessionCommandSandboxTable)
        .values({
          session_id: sessionID,
          created_event_id: created,
          version: 1,
          policy: { policy, ...(parent ? { parent } : {}) },
          time_created: Date.now(),
        })
        .run(),
    )
  return {
    /** Called before publish; pass both returned members to EventV2.publish(Created). */
    prepareRoot: (sessionID: SessionSchema.ID, policy: CommandSandboxPolicy.Policy) =>
      Effect.gen(function* () {
        const claim = yield* lifecycle.capture(sessionID)
        const resolved = yield* CommandSandboxPolicy.decode(policy).pipe(
          Effect.map(CommandSandboxPolicy.freeze),
          Effect.mapError(
            () =>
              new CommandSandboxPolicy.Failure({
                code: "invalid_policy",
                message: "The selected command sandbox policy is invalid.",
              }),
          ),
        )
        const eventID = EventV2.ID.create()
        const commit = storage(
          Effect.gen(function* () {
            if (!lifecycle.available(claim))
              return yield* failure("The original Session creation is no longer available.")
            const row = yield* db
              .select({ parent: SessionTable.parent_id })
              .from(SessionTable)
              .where(eq(SessionTable.id, sessionID))
              .get()
            if (!row || row.parent !== null)
              return yield* new CommandSandboxPolicy.Failure({
                code: "missing_inheritance",
                message: "Child Sessions require a trusted inherited command sandbox policy.",
              })
            yield* insert(sessionID, eventID, resolved)
          }),
        )
        return { eventID, commit }
      }),
    /** Retarget only the workspace; the original protected paths and confinement stay authoritative. */
    derive: (captured: Capability, target: CommandSandboxPolicy.Policy) =>
      Effect.gen(function* () {
        const parent = capabilities.get(captured)
        if (!parent || !lifecycle.available(parent.claim))
          return yield* failure("The parent command sandbox capability is unavailable.")
        if (parent.policy.profile !== target.profile || parent.policy.network !== target.network)
          return yield* failure("Child placement cannot change its command sandbox profile.")
        const derived = CommandSandboxPolicy.isOff(target)
          ? target
          : yield* CommandSandboxPaths.resolve({
              workspace: target.workspace,
              profile: target.profile,
              protected: [
                ...target.protected,
                ...(CommandSandboxPolicy.isOff(parent.policy) ? [] : parent.policy.protected),
              ],
              extraDenyLiterals: CommandSandboxPolicy.isOff(parent.policy) ? undefined : parent.policy.denyLiterals,
              extraDenyGlobs: CommandSandboxPolicy.isOff(parent.policy) ? undefined : parent.policy.denyGlobs,
            })
        const result: Capability = Object.freeze({ [capability]: true as const })
        capabilities.set(result, { ...parent, derived })
        return result
      }),
    /** A trusted creation caller publishes Created with this id and commit in one transaction. */
    prepareChild: (captured: Capability, childID: SessionSchema.ID) =>
      Effect.gen(function* () {
        const parent = capabilities.get(captured)
        if (!parent || !lifecycle.available(parent.claim))
          return yield* failure("The original parent command sandbox capability is no longer available.")
        const childClaim = yield* lifecycle.capture(childID)
        const eventID = EventV2.ID.create()
        const commit = storage(
          Effect.gen(function* () {
            if (!lifecycle.available(parent.claim) || !lifecycle.available(childClaim))
              return yield* failure("The original child creation is no longer available.")
            const current = yield* read(parent.claim.sessionID)
            if (current.created !== parent.created || current.policy.revision !== parent.policy.revision)
              return yield* failure("The parent command sandbox policy changed identity.")
            const row = yield* db
              .select({ parent: SessionTable.parent_id })
              .from(SessionTable)
              .where(eq(SessionTable.id, childID))
              .get()
            if (!row || row.parent !== parent.claim.sessionID)
              return yield* failure("The child creation does not belong to the captured parent.")
            yield* insert(childID, eventID, parent.derived ?? parent.policy, {
              sessionID: parent.claim.sessionID,
              createdEventID: parent.created,
            })
          }),
        )
        return { eventID, commit }
      }),
    /** Compatibility execution cannot bypass a selected native command policy. */
    assertLegacy: (sessionID: SessionSchema.ID) =>
      lifecycle.use(
        sessionID,
        Effect.gen(function* () {
          const current = yield* read(sessionID)
          if (current.policy.profile !== "off")
            return yield* failure(
              "This Session requires native command sandbox enforcement and cannot execute through compatibility routes.",
            )
        }),
      ),
    /** An omitted selection adopts the existing policy; an explicit different choice is rejected. */
    adopt: (sessionID: SessionSchema.ID, profile?: CommandSandboxPolicy.Policy["profile"]) =>
      lifecycle.use(
        sessionID,
        Effect.gen(function* () {
          const current = yield* read(sessionID)
          if (profile !== undefined && current.policy.profile !== profile)
            return yield* failure("The Session already has a different command sandbox profile.")
          return current.policy
        }),
      ),
    get: (sessionID: SessionSchema.ID) =>
      lifecycle.use(sessionID, read(sessionID).pipe(Effect.map((entry) => entry.policy))),
    inspect: (sessionID: SessionSchema.ID) =>
      lifecycle.use(
        sessionID,
        Effect.gen(function* () {
          const claim = yield* lifecycle.capture(sessionID)
          return { ...(yield* read(sessionID)), claim }
        }),
      ),
    capture: (sessionID: SessionSchema.ID) =>
      lifecycle.use(
        sessionID,
        Effect.gen(function* () {
          const claim = yield* lifecycle.capture(sessionID)
          const current = yield* read(sessionID)
          const captured: Capability = Object.freeze({ [capability]: true as const })
          capabilities.set(captured, { claim, ...current })
          return captured
        }),
      ),
    inherit: (captured: Capability, childID: SessionSchema.ID) =>
      Effect.suspend(() => {
        const parent = capabilities.get(captured)
        if (!parent || !lifecycle.available(parent.claim))
          return Effect.fail(failure("The original parent command sandbox capability is no longer available."))
        return lifecycle.owned(
          parent.claim,
          lifecycle.child(
            parent.claim.sessionID,
            childID,
            storage(
              db.transaction(
                () =>
                  Effect.gen(function* () {
                    const current = yield* read(parent.claim.sessionID)
                    if (current.created !== parent.created || current.policy.revision !== parent.policy.revision)
                      return yield* failure("The parent command sandbox policy changed identity.")
                    const child = yield* proof(childID)
                    if (child.parentID !== parent.claim.sessionID)
                      return yield* failure("The child creation does not belong to the captured parent.")
                    const previous = yield* db
                      .select()
                      .from(SessionCommandSandboxTable)
                      .where(eq(SessionCommandSandboxTable.session_id, childID))
                      .get()
                    if (previous) {
                      const existing = yield* read(childID)
                      if (existing.created !== child.id || existing.policy.revision !== parent.policy.revision)
                        return yield* failure("The child already has a different command sandbox policy.")
                      if (
                        existing.parent?.sessionID === parent.claim.sessionID &&
                        existing.parent.createdEventID === parent.created
                      )
                        return
                      if (
                        existing.parent ||
                        existing.origin !== "migration" ||
                        current.origin !== "migration" ||
                        existing.policy.profile !== "off" ||
                        current.policy.profile !== "off"
                      )
                        return yield* failure("The child has no matching private command sandbox lineage.")
                      // Baseline off grants no new authority. This records current policy lineage,
                      // not historical Goal/Workflow execution ownership; those domains validate first.
                      yield* db
                        .update(SessionCommandSandboxTable)
                        .set({
                          policy: {
                            policy: existing.policy,
                            origin: "migration",
                            parent: { sessionID: parent.claim.sessionID, createdEventID: parent.created },
                          },
                        })
                        .where(eq(SessionCommandSandboxTable.session_id, childID))
                        .run()
                      return
                    }
                    yield* insert(childID, child.id, parent.policy, {
                      sessionID: parent.claim.sessionID,
                      createdEventID: parent.created,
                    })
                  }),
                { behavior: "immediate" },
              ),
            ),
          ),
        )
      }),
  }
})

export type Interface = Effect.Success<typeof make>
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionCommandSandbox") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Database.node, SessionLifecycle.node],
})
