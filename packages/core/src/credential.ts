export * as Credential from "./credential"

import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Credential } from "@apexo/schema/credential"
import { Integration } from "@apexo/schema/integration"
import { NonNegativeInt } from "@apexo/schema/schema"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { Global } from "./global"
import { CredentialTable } from "./credential/sql"

export const ID = Credential.ID
export type ID = Credential.ID

export const OAuth = Credential.OAuth
export type OAuth = Credential.OAuth

export const Key = Credential.Key
export type Key = Credential.Key

export const External = Credential.External
export type External = Credential.External

export const Value = Credential.Value
export type Value = Credential.Value

export class Info extends Schema.Class<Info>("Credential.Info")({
  id: ID,
  integrationID: Integration.ID,
  label: Schema.String,
  value: Value,
}) {}

export interface Interface {
  /** Returns every stored credential. */
  readonly all: () => Effect.Effect<Info[]>
  /** Returns stored credentials belonging to one integration. */
  readonly list: (integrationID: Integration.ID) => Effect.Effect<Info[]>
  /** Returns one stored credential by ID. */
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  /** Replaces any credential for an integration and returns the new record. */
  readonly create: (input: {
    readonly integrationID: Integration.ID
    readonly value: Value
    readonly label?: string
  }) => Effect.Effect<Info>
  /** Updates the label or secret value of a stored credential. */
  readonly update: (id: ID, updates: Partial<Pick<Info, "label" | "value">>) => Effect.Effect<void>
  /** Removes a stored credential. */
  readonly remove: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/v2/Credential") {}

const parseJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

function jwtExp(token: string) {
  const payload = token.split(".")[1]
  if (!payload) return
  const decoded = Option.getOrUndefined(parseJson(Buffer.from(payload, "base64url").toString("utf8")))
  if (!decoded || typeof decoded !== "object" || !("exp" in decoded) || typeof decoded.exp !== "number") return
  return decoded.exp * 1000
}

function legacyId(integrationID: string) {
  return ID.make(`cred_${createHash("sha256").update(`legacy:${integrationID}`).digest("hex").slice(0, 24)}`)
}

function toLegacyValue(raw: unknown): Value | undefined {
  if (!raw || typeof raw !== "object" || !("type" in raw)) return
  if ((raw.type === "api" || raw.type === "wellknown") && "key" in raw && typeof raw.key === "string" && raw.key) {
    return { type: "key", key: raw.key }
  }
  if (
    raw.type === "oauth" &&
    "access" in raw &&
    typeof raw.access === "string" &&
    raw.access &&
    "refresh" in raw &&
    typeof raw.refresh === "string" &&
    raw.refresh &&
    "expires" in raw &&
    typeof raw.expires === "number"
  ) {
    const exp = jwtExp(raw.access)
    const expires = Math.max(0, Math.trunc(exp !== undefined ? Math.min(raw.expires, exp) : raw.expires))
    return {
      type: "oauth",
      methodID: Integration.MethodID.make("oauth"),
      access: raw.access,
      refresh: raw.refresh,
      expires: NonNegativeInt.make(expires),
      ...("accountId" in raw && typeof raw.accountId === "string"
        ? { metadata: { accountId: raw.accountId } }
        : {}),
    }
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const global = Option.getOrUndefined(yield* Effect.serviceOption(Global.Service))
    const home = global?.home ?? Global.Path.home
    const dataDir =
      global && global.home !== Global.Path.home && global.data === Global.Path.data
        ? path.join(global.home, ".local", "share", Global.APP_DIR_NAME)
        : (global?.data ?? Global.Path.data)
    const authFile = path.join(dataDir, "auth.json")
    const grokFile = path.join(home, ".grok", "auth.json")
    const decode = Schema.decodeUnknownSync(Value)
    const stored = (row: typeof CredentialTable.$inferSelect) => {
      if (!row.integration_id) return
      return new Info({
        id: row.id,
        integrationID: row.integration_id,
        label: row.label,
        value: decode(row.value),
      })
    }

    const legacyAll = Effect.fnUntraced(function* () {
      const fromEnv = process.env.APEXO_AUTH_CONTENT ? Option.getOrUndefined(parseJson(process.env.APEXO_AUTH_CONTENT)) : undefined
      const authText = yield* Effect.promise(() => fs.readFile(authFile, "utf8").catch(() => ""))
      const fromFile = authText ? Option.getOrUndefined(parseJson(authText)) : undefined
      const merged: Record<string, unknown> = {
        ...(fromFile && typeof fromFile === "object" ? (fromFile as Record<string, unknown>) : {}),
        ...(fromEnv && typeof fromEnv === "object" ? (fromEnv as Record<string, unknown>) : {}),
      }
      const grokText = yield* Effect.promise(() => fs.readFile(grokFile, "utf8").catch(() => ""))
      const grokParsed = grokText ? Option.getOrUndefined(parseJson(grokText)) : undefined
      if (
        grokParsed &&
        typeof grokParsed === "object" &&
        "access_token" in grokParsed &&
        typeof grokParsed.access_token === "string" &&
        grokParsed.access_token &&
        "refresh_token" in grokParsed &&
        typeof grokParsed.refresh_token === "string" &&
        grokParsed.refresh_token
      ) {
        const exp =
          jwtExp(grokParsed.access_token) ??
          ("expires_at" in grokParsed && typeof grokParsed.expires_at === "number"
            ? grokParsed.expires_at > 1e12
              ? grokParsed.expires_at
              : grokParsed.expires_at * 1000
            : Date.now() + 3600_000)
        const existingXai = merged["xai"]
        const existingAccess =
          existingXai && typeof existingXai === "object" && "access" in existingXai && typeof existingXai.access === "string"
            ? existingXai.access
            : undefined
        const existingExp = existingAccess ? (jwtExp(existingAccess) ?? 0) : 0
        if (!existingXai || exp >= existingExp) {
          merged["xai"] = {
            type: "oauth",
            access: grokParsed.access_token,
            refresh: grokParsed.refresh_token,
            expires: exp,
          }
        }
      }
      return Object.entries(merged).flatMap(([key, raw]) => {
        const value = toLegacyValue(raw)
        if (!value) return []
        return [
          new Info({
            id: legacyId(key),
            integrationID: Integration.ID.make(key),
            label: "default",
            value,
          }),
        ]
      })
    })

    const syncLegacyWrite = Effect.fnUntraced(function* (integrationID: Integration.ID, value: Value) {
      const authText = yield* Effect.promise(() => fs.readFile(authFile, "utf8").catch(() => ""))
      const current = authText ? Option.getOrUndefined(parseJson(authText)) : undefined
      const map: Record<string, unknown> =
        current && typeof current === "object" ? { ...(current as Record<string, unknown>) } : {}
      if (value.type === "oauth") {
        const accountId =
          value.metadata && typeof value.metadata.accountId === "string" ? value.metadata.accountId : undefined
        map[integrationID] = {
          type: "oauth",
          access: value.access,
          refresh: value.refresh,
          expires: value.expires,
          ...(accountId ? { accountId } : {}),
        }
      }
      if (value.type === "key") {
        map[integrationID] = {
          type: "api",
          key: value.key,
        }
      }
      yield* Effect.promise(async () => {
        await fs.mkdir(path.dirname(authFile), { recursive: true })
        await fs.writeFile(authFile, JSON.stringify(map, null, 2), { mode: 0o600 })
      }).pipe(Effect.ignore)
      if (integrationID === "xai" && value.type === "oauth") {
        const hasGrok = yield* Effect.promise(() =>
          fs
            .access(grokFile)
            .then(() => true)
            .catch(() => false),
        )
        if (hasGrok) {
          yield* Effect.promise(() =>
            fs.writeFile(
              grokFile,
              JSON.stringify(
                {
                  access_token: value.access,
                  refresh_token: value.refresh,
                  expires_at: Math.floor(value.expires / 1000),
                },
                null,
                2,
              ),
              { mode: 0o600 },
            ),
          ).pipe(Effect.ignore)
        }
      }
    })

    return Service.of({
      all: Effect.fn("Credential.all")(function* () {
        const rows = (yield* db
          .select()
          .from(CredentialTable)
          .orderBy(asc(CredentialTable.time_created))
          .all()
          .pipe(Effect.orDie)).flatMap((row) => {
          const credential = stored(row)
          return credential ? [credential] : []
        })
        const seen = new Set(rows.map((item) => item.integrationID))
        const legacy = (yield* legacyAll()).filter((item) => !seen.has(item.integrationID))
        return [...rows, ...legacy]
      }),
      list: Effect.fn("Credential.list")(function* (integrationID) {
        const rows = (yield* db
          .select()
          .from(CredentialTable)
          .where(eq(CredentialTable.integration_id, integrationID))
          .orderBy(asc(CredentialTable.time_created))
          .all()
          .pipe(Effect.orDie)).flatMap((row) => {
          const credential = stored(row)
          return credential ? [credential] : []
        })
        if (rows.length > 0) return rows
        return (yield* legacyAll()).filter((item) => item.integrationID === integrationID)
      }),
      get: Effect.fn("Credential.get")(function* (id) {
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        if (row) return stored(row)
        return (yield* legacyAll()).find((item) => item.id === id)
      }),
      create: Effect.fn("Credential.create")(function* (input) {
        const credential = new Info({
          id: ID.create(),
          integrationID: input.integrationID,
          label: input.label ?? "default",
          value: input.value,
        })
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .delete(CredentialTable)
                .where(eq(CredentialTable.integration_id, credential.integrationID))
                .run()
              yield* tx
                .insert(CredentialTable)
                .values({
                  id: credential.id,
                  integration_id: credential.integrationID,
                  label: credential.label,
                  value: credential.value,
                })
                .run()
            }),
          )
          .pipe(Effect.orDie)
        return credential
      }),
      update: Effect.fn("Credential.update")(function* (id, updates) {
        if (!updates.label && !updates.value) return
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        if (row) {
          yield* db
            .update(CredentialTable)
            .set({ label: updates.label, value: updates.value })
            .where(eq(CredentialTable.id, id))
            .run()
            .pipe(Effect.orDie)
          if (updates.value && row.integration_id) yield* syncLegacyWrite(row.integration_id, updates.value)
          return
        }
        const legacy = (yield* legacyAll()).find((item) => item.id === id)
        if (!legacy || !updates.value) return
        yield* syncLegacyWrite(legacy.integrationID, updates.value)
      }),
      remove: Effect.fn("Credential.remove")(function* (id) {
        yield* db.delete(CredentialTable).where(eq(CredentialTable.id, id)).run().pipe(Effect.orDie)
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
