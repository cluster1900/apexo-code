export * as McpOAuthStore from "./mcp-oauth-store"

import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { mkdir, open, rename, rm } from "node:fs/promises"
import path from "node:path"
import { Option, Schema } from "effect"
import { Flock } from "./util/flock"

const text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(65536))
export const Credentials = Schema.Struct({
  issuer: text,
  clientId: text,
  clientSecret: Schema.optional(text),
  accessToken: text,
  refreshToken: Schema.optional(text),
  expiresAt: Schema.optional(Schema.Number.check(Schema.isFinite())),
  scope: Schema.optional(Schema.String.check(Schema.isMaxLength(65536))),
})
export type Credentials = typeof Credentials.Type
const Document = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    identity: text,
    revision: text,
    credentials: Credentials,
  }),
)
export type Snapshot = {
  readonly revision?: string
  readonly credentials?: Credentials
}
export class Failure extends Error {
  constructor(readonly code: "storage" | "conflict") {
    super(
      code === "storage"
        ? "Could not access saved MCP authentication; repair the private credential store and try again"
        : "MCP authentication changed elsewhere; retry with the current credentials",
    )
    this.name = "McpOAuthStore.Failure"
  }
}
const MAX_BYTES = 256 * 1024
const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
export const key = (identity: string) => createHash("sha256").update(identity).digest("hex")
export const file = (data: string, identity: string) => path.join(data, "mcp-oauth", `${key(identity)}.json`)

/** Every write belongs to one locked identity; tokens never travel through public status. */
export function make(data: string) {
  const read = async (identity: string): Promise<Snapshot> => {
    const handle = await open(file(data, identity), constants.O_RDONLY | constants.O_NOFOLLOW).catch(
      (error: unknown) => {
        if (missing(error)) return undefined
        throw new Failure("storage")
      },
    )
    if (!handle) return {}
    return handle
      .stat()
      .then(async (info) => {
        if (!info.isFile() || info.size > MAX_BYTES || (process.platform !== "win32" && (info.mode & 0o077) !== 0))
          throw new Failure("storage")
        const buffer = Buffer.alloc(MAX_BYTES + 1)
        const offset = { value: 0 }
        while (offset.value < buffer.length) {
          const result = await handle.read(buffer, offset.value, buffer.length - offset.value, offset.value)
          if (!result.bytesRead) break
          offset.value += result.bytesRead
        }
        if (offset.value > MAX_BYTES) throw new Failure("storage")
        const raw = buffer.subarray(0, offset.value).toString("utf8")
        const decoded = Schema.decodeUnknownOption(Document)(raw)
        if (Option.isNone(decoded) || decoded.value.identity !== key(identity)) throw new Failure("storage")
        return {
          revision: decoded.value.revision,
          credentials: decoded.value.credentials,
        }
      })
      .catch(() => {
        throw new Failure("storage")
      })
      .finally(() => handle.close())
  }
  const write = async (
    identity: string,
    credentials: Credentials,
    active: () => boolean,
    revision: string | undefined,
  ) => {
    const checked = Schema.decodeUnknownOption(Credentials)(credentials)
    if (Option.isNone(checked)) throw new Failure("storage")
    const snapshot = {
      version: 1 as const,
      identity: key(identity),
      revision: randomUUID(),
      credentials: checked.value,
    }
    const raw = Schema.encodeSync(Document)(snapshot)
    if (Buffer.byteLength(raw) > MAX_BYTES) throw new Failure("storage")
    const target = file(data, identity)
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    const temporary = `${target}.${randomUUID()}.tmp`
    const handle = await open(temporary, "wx", 0o600)
    await handle
      .writeFile(raw)
      .then(() => handle.sync())
      .finally(() => handle.close())
      .then(async () => {
        // The final synchronous check precedes the atomic publication call. Once
        // rename starts, the caller joins this commit even if its scope is canceled.
        if ((await read(identity)).revision !== revision || !active()) throw new Failure("conflict")
        await rename(temporary, target)
        if (process.platform !== "win32") {
          const parent = await open(path.dirname(target), "r")
          await parent.sync().finally(() => parent.close())
        }
      })
      .catch(async (error: unknown) => {
        await rm(temporary, { force: true })
        throw error instanceof Failure ? error : new Failure("storage")
      })
    return { revision: snapshot.revision, credentials: checked.value }
  }
  const transaction = async <A>(
    identity: string,
    signal: AbortSignal,
    active: () => boolean,
    operation: (
      snapshot: Snapshot,
      commit: (credentials: Credentials, forward?: boolean) => Promise<Snapshot>,
    ) => Promise<A>,
  ) => {
    // Flock owns the acquisition abort race; finally joins release, including when
    // the signal becomes aborted immediately after acquisition wins.
    const lease = await Flock.acquire(file(data, identity), {
      dir: path.join(data, "mcp-oauth", ".locks"),
      signal,
      timeoutMs: 10000,
      reclaimDeadOwner: true,
    }).catch(() => {
      throw new Failure("storage")
    })
    return Promise.resolve()
      .then(async () => {
        signal.throwIfAborted()
        if (!active()) throw new Failure("conflict")
        const initial = await read(identity)
        const current = { revision: initial.revision }
        return operation(initial, async (credentials, forward = false) => {
          if (!forward && (!active() || signal.aborted)) throw new Failure("conflict")
          // Cooperating writers serialize under this lease. Recheck near rename
          // too, but the filesystem offers no CAS against a writer bypassing it.
          // A known successful refresh may commit after runtime cancellation.
          if ((await read(identity)).revision !== current.revision) throw new Failure("conflict")
          const saved = await write(
            identity,
            credentials,
            () => forward || (active() && !signal.aborted),
            current.revision,
          )
          current.revision = saved.revision
          return saved
        })
      })
      .finally(() => lease.release())
  }
  return { read, transaction }
}
