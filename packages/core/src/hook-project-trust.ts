export * as HookProjectTrust from "./hook-project-trust"

import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { lstat, mkdir, open, realpath, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { Schema } from "effect"
import { parse } from "toml"
import type { Git } from "./git"
import { Flock } from "./util/flock"

const Record = Schema.Struct({ identity: Schema.String, revision: Schema.String, trusted: Schema.Boolean })
const Document = Schema.fromJsonString(
  Schema.Struct({ version: Schema.Literal(1), repositories: Schema.Record(Schema.String, Record) }),
)
export type Proof = {
  readonly workspace: string
  readonly root: string
  readonly git: string
  readonly common: string
  readonly identity: string
}
export type Authority = {
  readonly workspace: string
  readonly home: string
  readonly data: string
  readonly directoryIdentity: string
  readonly repository?: Proof
  readonly revision?: string
  readonly mode: "exact" | "repository"
}
export type Consent = { root: string; token: string; trusted: boolean }
export type Preview = Consent & { allowed: boolean }
export class Failure extends Error {
  constructor(message = "Repository Hook trust could not be verified") {
    super(message)
    this.name = "HookProjectTrust.Failure"
  }
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
const contains = (root: string, directory: string) => directory === root || directory.startsWith(`${root}${path.sep}`)
export const file = (data: string) => path.join(data, "hooks", "repository-trust.json")

/** Git discovery belongs to the native Git service; this only binds its result to current filesystem identity. */
export async function capture(
  directory: string,
  userHome: string,
  repository?: Git.Repository,
): Promise<Proof | undefined> {
  if (!repository) return
  const workspace = await realpath(directory)
  const root = await realpath(repository.worktree)
  if (root === path.parse(root).root || root === (await realpath(userHome)) || !contains(root, workspace)) return
  const candidate = {
    workspace,
    root,
    git: await realpath(repository.gitDirectory),
    common: await realpath(repository.commonDirectory),
  }
  return { ...candidate, identity: await identity(candidate) }
}

export async function directoryIdentity(directory: string) {
  const info = await stat(directory)
  if (!info.isDirectory()) throw new Failure()
  return digest([info.dev, info.ino])
}

async function identity(proof: Omit<Proof, "identity">) {
  if ((await realpath(proof.workspace)) !== proof.workspace || (await realpath(proof.root)) !== proof.root)
    throw new Failure()
  // A new nearer .git boundary invalidates the captured repository capability.
  for (let current = proof.workspace; current !== proof.root; current = path.dirname(current)) {
    if (
      !contains(proof.root, current) ||
      (await lstat(path.join(current, ".git")).catch((error) => {
        if (missing(error)) return undefined
        throw error
      }))
    )
      throw new Failure()
  }
  const marker = path.join(proof.root, ".git")
  const info = await lstat(marker)
  if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Failure()
  const content = info.isFile() ? await bounded(marker, 4096) : undefined
  const linked = content === undefined ? undefined : /^gitdir: (.+)\s*$/.exec(content)?.[1]?.trim()
  if (content !== undefined && !linked) throw new Failure()
  const target = linked === undefined ? marker : path.resolve(proof.root, linked)
  if ((await realpath(target)) !== proof.git) throw new Failure()
  if ((await realpath(proof.git)) !== proof.git || (await realpath(proof.common)) !== proof.common) throw new Failure()
  const common = await bounded(path.join(proof.git, "commondir"), 4096).catch((error) => {
    if (missing(error)) return undefined
    throw error
  })
  if ((await realpath(common === undefined ? proof.git : path.resolve(proof.git, common.trim()))) !== proof.common)
    throw new Failure()
  return digest([
    proof.root,
    await directoryIdentity(proof.root),
    proof.git,
    await directoryIdentity(proof.git),
    proof.common,
    await directoryIdentity(proof.common),
    info.dev,
    info.ino,
    content,
    common,
  ])
}

async function parentIdentity(directory: string) {
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Failure()
  return digest([await realpath(directory), info.dev, info.ino])
}

async function bounded(target: string, limit = 1024 * 1024) {
  const parent = await parentIdentity(path.dirname(target))
  const before = await lstat(target)
  if (!before.isFile() || before.isSymbolicLink() || before.size > limit) throw new Failure()
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  return await handle
    .stat()
    .then(async (info) => {
      if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino || info.size > limit) throw new Failure()
      const bytes = Buffer.alloc(limit + 1)
      let size = 0
      while (size < bytes.length) {
        const result = await handle.read(bytes, size, bytes.length - size, size)
        if (!result.bytesRead) break
        size += result.bytesRead
      }
      const settled = await handle.stat()
      if (
        settled.size !== info.size ||
        settled.mtimeMs !== info.mtimeMs ||
        settled.ctimeMs !== info.ctimeMs ||
        size !== settled.size
      )
        throw new Failure()
      const after = await lstat(target)
      if (
        size > limit ||
        !after.isFile() ||
        after.isSymbolicLink() ||
        after.dev !== info.dev ||
        after.ino !== info.ino ||
        after.size !== settled.size ||
        after.mtimeMs !== settled.mtimeMs ||
        parent !== (await parentIdentity(path.dirname(target)))
      )
        throw new Failure()
      return bytes.subarray(0, size).toString("utf8")
    })
    .finally(() => handle.close())
}

async function read(data: string) {
  const raw = await bounded(file(data)).catch((error) => {
    if (missing(error)) return undefined
    throw new Failure()
  })
  if (raw === undefined)
    return { version: 1 as const, repositories: {} as Record<string, Schema.Schema.Type<typeof Record>> }
  return await Schema.decodeUnknownPromise(Document)(raw).catch(() => {
    throw new Failure()
  })
}

export async function inspect(data: string, proof: Proof, home?: string): Promise<Preview> {
  if ((await identity(proof)) !== proof.identity) throw new Failure()
  const saved = (await read(data)).repositories[proof.root]
  return {
    root: proof.root,
    token: digest([proof.identity, saved?.revision ?? ""]),
    trusted: saved?.identity === proof.identity && saved.trusted,
    allowed:
      saved?.identity === proof.identity &&
      saved.trusted &&
      !(home && (await legacy(home, proof.workspace, proof.root)).denied),
  }
}

export async function decision(data: string, proof: Proof) {
  if ((await identity(proof)) !== proof.identity) throw new Failure()
  const saved = (await read(data)).repositories[proof.root]
  // A stale grant never authorizes a replacement repository. A denial stays restrictive.
  return saved?.trusted === false ? saved : saved?.identity === proof.identity ? saved : undefined
}

export async function change(data: string, proof: Proof, input: Consent, current?: () => boolean) {
  const target = file(data)
  const directory = path.dirname(target)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const parent = await parentIdentity(directory)
  const lease = await Flock.acquire(target, {
    dir: path.join(directory, ".locks"),
    timeoutMs: 5000,
    reclaimDeadOwner: true,
  })
  try {
    if (parent !== (await parentIdentity(directory))) throw new Failure()
    if (current && !current()) throw new Failure("Session Hook owner was released")
    const preview = await inspect(data, proof)
    if (input.root !== preview.root || input.token !== preview.token)
      throw new Failure("Repository identity or trust changed; refresh before retrying")
    const document = await read(data)
    const next = {
      version: 1 as const,
      repositories: {
        ...document.repositories,
        [proof.root]: { identity: proof.identity, revision: randomUUID(), trusted: input.trusted },
      },
    }
    const raw = await Schema.encodePromise(Document)(next)
    if (Buffer.byteLength(raw) > 1024 * 1024) throw new Failure()
    const temporary = `${target}.${randomUUID()}.tmp`
    if (parent !== (await parentIdentity(directory))) throw new Failure()
    if (current && !current()) throw new Failure("Session Hook owner was released")
    const handle = await open(temporary, "wx", 0o600)
    const owned = await handle.stat()
    await handle
      .writeFile(raw)
      .then(() => handle.sync())
      .finally(() => handle.close())
      .then(async () => {
        if (parent !== (await parentIdentity(directory))) throw new Failure()
        if (current && !current()) throw new Failure("Session Hook owner was released")
        await rename(temporary, target)
        if (parent !== (await parentIdentity(directory))) throw new Failure()
      })
      .catch(async (error: unknown) => {
        if (parent === (await parentIdentity(directory).catch(() => undefined))) {
          const current = await lstat(temporary).catch(() => undefined)
          if (current?.isFile() && !current.isSymbolicLink() && current.dev === owned.dev && current.ino === owned.ino)
            await rm(temporary)
        }
        throw error
      })
    if (process.platform !== "win32") {
      const parent = await open(directory, "r")
      await parent.sync().finally(() => parent.close())
    }
  } finally {
    await lease.release()
  }
}

/** No definition reload: validate only the captured authority immediately before external work. */
export async function authorize(authority: Authority) {
  if (
    (await realpath(authority.workspace)) !== authority.workspace ||
    (await directoryIdentity(authority.workspace)) !== authority.directoryIdentity
  )
    throw new Failure()
  const saved = authority.repository ? await decision(authority.data, authority.repository) : undefined
  if (saved?.trusted === false) throw new Failure("Repository Hook trust was revoked")
  if (saved?.revision !== authority.revision) throw new Failure("Repository Hook grant changed; reload Hooks")
  const previous = await legacy(authority.home, authority.workspace, authority.repository?.root)
  if (previous.denied) throw new Failure("Host folder Hook trust is denied or unavailable")
  if (authority.mode === "repository") {
    if (!saved?.trusted || saved.revision !== authority.revision)
      throw new Failure("Repository Hook grant changed; reload Hooks")
    return
  }
  if (!previous.exact) throw new Failure("Exact folder Hook trust was revoked")
}

export async function legacy(home: string, workspace: string, root?: string) {
  return await bounded(path.join(home, "trusted_folders.toml"))
    .catch((error) => {
      if (missing(error)) return ""
      throw error
    })
    .then((raw) => {
      const store: unknown = parse(raw)
      const folders = typeof store === "object" && store !== null ? Reflect.get(store, "folders") : undefined
      const decision = (key: string) => {
        const entry = typeof folders === "object" && folders !== null ? Reflect.get(folders, key) : undefined
        return typeof entry === "object" && entry !== null ? Reflect.get(entry, "trusted") : undefined
      }
      return {
        exact: decision(workspace) === true,
        denied: decision(workspace) === false || (root !== undefined && decision(root) === false),
      }
    })
    .catch(() => ({ exact: false, denied: true }))
}
