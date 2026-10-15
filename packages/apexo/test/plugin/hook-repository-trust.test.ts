import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir, readFile, rename, rm, symlink } from "node:fs/promises"
import { HookProjectTrust } from "@apexo/core/hook-project-trust"
import { HostHooks } from "@apexo/core/hooks"
import { HookDispatch } from "@apexo/core/hook-dispatch"
import { Git } from "@apexo/core/git"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdir } from "../fixture/fixture"
import { hookTLS } from "../fixture/hook-tls"
import { HookNetwork } from "@apexo/core/hook-network"
import { Flock } from "@apexo/core/util/flock"

async function fixture(root: string) {
  const home = path.join(root, "home")
  const data = path.join(root, "data")
  const nested = path.join(root, "nested")
  await Promise.all([mkdir(home), mkdir(data), mkdir(nested)])
  const repository = new Git.Repository({
    worktree: AbsolutePath.make(root),
    gitDirectory: AbsolutePath.make(path.join(root, ".git")),
    commonDirectory: AbsolutePath.make(path.join(root, ".git")),
  })
  const proof = await HookProjectTrust.capture(nested, home, repository)
  if (!proof) throw new Error("Fixture repository was not captured")
  const command = `printf '{"root":true}'`
  await Bun.write(
    path.join(root, ".grok/hooks/root.json"),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } }),
  )
  await Bun.write(
    path.join(nested, ".grok/hooks/nested.json"),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: `printf '{"nested":true}'` }] }] } }),
  )
  return { home, data, nested, repository, proof }
}
async function grant(input: Awaited<ReturnType<typeof fixture>>, trusted = true) {
  await HookProjectTrust.change(input.data, input.proof, {
    ...(await HookProjectTrust.inspect(input.data, input.proof)),
    trusted,
  })
}
async function captured(input: Awaited<ReturnType<typeof fixture>>) {
  const inspection = await HostHooks.discover(input.nested, input.home, input.home, {
    proof: input.proof,
    data: input.data,
  })
  const source = inspection.sources.find((source) => source.name.endsWith("root.json"))
  if (!source) throw new Error("Repository root Hook was not discovered")
  const hook = (source.hooks.Stop as { hooks: Record<string, unknown>[] }[])[0].hooks[0]
  return { source, hook }
}
const run = (input: Awaited<ReturnType<typeof fixture>>, current: Awaited<ReturnType<typeof captured>>) =>
  HookDispatch.run(
    current.hook,
    "{}",
    current.source.root,
    input.nested,
    1000,
    true,
    "Stop",
    undefined,
    "root",
    undefined,
    current.source.projectAuthority,
  )

test("explicit repository Hook consent loads root hooks from nested cwd without broadening exact grants", async () => {
  await using tmp = await tmpdir({ git: true })
  const input = await fixture(tmp.path)
  await Bun.write(
    path.join(input.home, "trusted_folders.toml"),
    `[folders.${JSON.stringify(tmp.path)}]\ntrusted=true\n`,
  )
  expect((await HostHooks.discover(input.nested, input.home, input.home)).sources).toHaveLength(0)
  await grant(input)
  const current = await captured(input)
  expect(await run(input, current)).toBe('{"root":true}')
  expect(
    (
      await HostHooks.discover(input.nested, input.home, input.home, { proof: input.proof, data: input.data })
    ).sources.map((x) => path.basename(x.name)),
  ).toEqual(["root.json"])
  expect(input.proof.workspace).toBe(input.nested)
})

test("repository revocation fences captured commands and regrant never revives an old capability", async () => {
  await using tmp = await tmpdir({ git: true })
  const input = await fixture(tmp.path)
  const marker = path.join(tmp.path, "executed")
  await Bun.write(
    path.join(tmp.path, ".grok/hooks/root.json"),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: `touch '${marker}'` }] }] } }),
  )
  await grant(input)
  const current = await captured(input)
  await grant(input, false)
  await expect(run(input, current)).rejects.toThrow()
  expect(await Bun.file(marker).exists()).toBe(false)
  await grant(input)
  await expect(run(input, current)).rejects.toThrow()
  expect(await Bun.file(marker).exists()).toBe(false)
  await run(input, await captured(input))
  expect(await Bun.file(marker).exists()).toBe(true)
})

test("captured repository hook revocation blocks HTTP before any request", async () => {
  await using tmp = await tmpdir({ git: true })
  const input = await fixture(tmp.path)
  const requests: string[] = []
  using tls = hookTLS()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    tls: tls.tls,
    fetch: async (request) => {
      await request.text()
      requests.push(request.url)
      return new Response("{}")
    },
  })
  try {
    await grant(input)
    const current = await captured(input)
    expect(
      await HookDispatch.run(
        { type: "http", url: `https://127.0.0.1:${server.port}/hook` },
        "{}",
        current.source.root,
        input.nested,
        1000,
        true,
        "Stop",
        undefined,
        "root",
        undefined,
        current.source.projectAuthority,
      ),
    ).toBe("{}")
    expect(requests).toHaveLength(1)
    await grant(input, false)
    await expect(
      HookDispatch.run(
        { type: "http", url: `https://127.0.0.1:${server.port}/hook` },
        "{}",
        current.source.root,
        input.nested,
        1000,
        true,
        "Stop",
        undefined,
        "root",
        undefined,
        current.source.projectAuthority,
      ),
    ).rejects.toThrow()
    expect(requests).toHaveLength(1)
  } finally {
    await server.stop(true)
  }
})

test("new nested Git boundary and replaced root metadata invalidate captured repository authority", async () => {
  await using tmp = await tmpdir({ git: true })
  const input = await fixture(tmp.path)
  await grant(input)
  const current = await captured(input)
  await mkdir(path.join(input.nested, ".git"))
  await expect(run(input, current)).rejects.toThrow()
  await rm(path.join(input.nested, ".git"), { recursive: true })
  await rename(path.join(tmp.path, ".git"), path.join(tmp.path, ".git-retired"))
  await mkdir(path.join(tmp.path, ".git"))
  await expect(run(input, current)).rejects.toThrow()
})

test("symlink aliases share identity while stale preview tokens and replacement targets cannot grant", async () => {
  await using tmp = await tmpdir({ git: true })
  const input = await fixture(tmp.path)
  const alias = path.join(tmp.path, "alias")
  await symlink(input.nested, alias)
  const proof = await HookProjectTrust.capture(alias, input.home, input.repository)
  expect(proof).toEqual(input.proof)
  const preview = await HookProjectTrust.inspect(input.data, input.proof)
  await grant(input)
  await expect(HookProjectTrust.change(input.data, input.proof, { ...preview, trusted: false })).rejects.toThrow()
  expect((await HookProjectTrust.inspect(input.data, input.proof)).trusted).toBe(true)
})

test("trust store and legacy symlinks, malformed and oversized records fail closed", async () => {
  await using tmp = await tmpdir({ git: true })
  const input = await fixture(tmp.path)
  await grant(input)
  const current = await captured(input)
  const target = HookProjectTrust.file(input.data)
  const retained = path.join(tmp.path, "retained.json")
  await rename(target, retained)
  await symlink(retained, target)
  await expect(run(input, current)).rejects.toThrow()
  await rm(target)
  await Bun.write(target, "{")
  await expect(run(input, current)).rejects.toThrow()
  await Bun.write(target, " ".repeat(1024 * 1024 + 1))
  await expect(run(input, current)).rejects.toThrow()
  await rm(target)
  await rename(retained, target)
  await Bun.write(path.join(tmp.path, "legacy.toml"), `[folders.${JSON.stringify(input.nested)}]\ntrusted=true\n`)
  await symlink(path.join(tmp.path, "legacy.toml"), path.join(input.home, "trusted_folders.toml"))
  await expect(run(input, current)).rejects.toThrow()
})

test("explicit repository denial fences legacy exact sources without rewriting the legacy trust file", async () => {
  await using tmp = await tmpdir({ git: true })
  const input = await fixture(tmp.path)
  const target = path.join(input.home, "trusted_folders.toml")
  const legacy = `[folders.${JSON.stringify(input.nested)}]\ntrusted=true\n`
  await Bun.write(target, legacy)
  const source = (
    await HostHooks.discover(input.nested, input.home, input.home, { proof: input.proof, data: input.data })
  ).sources[0]
  expect(source.projectAuthority?.mode).toBe("exact")
  await grant(input, false)
  await expect(HookProjectTrust.authorize(source.projectAuthority!)).rejects.toThrow()
  expect(await readFile(target, "utf8")).toBe(legacy)
})

test("home and filesystem roots cannot become repository Hook grants", async () => {
  await using tmp = await tmpdir({ git: true })
  const input = await fixture(tmp.path)
  expect(await HookProjectTrust.capture(input.nested, tmp.path, input.repository)).toBeUndefined()
  expect(await HookProjectTrust.capture(input.nested, input.home)).toBeUndefined()
})

test("symlinked store directory cannot redirect trust publication", async () => {
  await using tmp = await tmpdir({ git: true })
  const input = await fixture(tmp.path)
  const outside = path.join(tmp.path, "outside")
  await mkdir(outside)
  await symlink(outside, path.join(input.data, "hooks"))
  await expect(grant(input)).rejects.toThrow()
  expect(await Bun.file(path.join(outside, "repository-trust.json")).exists()).toBe(false)
})

test("final HTTPS authority callback rechecks consent after preparation before request", async () => {
  await using tmp = await tmpdir({ git: true })
  const input = await fixture(tmp.path)
  await grant(input)
  const current = await captured(input)
  using tls = hookTLS()
  const requests: string[] = []
  using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    tls: tls.tls,
    fetch: async (request) => {
      await request.text()
      requests.push(request.url)
      return new Response("{}")
    },
  })
  const ready = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const pending = HookNetwork.post(new URL("/guard", server.url), "{}", {}, AbortSignal.timeout(3000), async () => {
    ready.resolve()
    await release.promise
    await HookProjectTrust.authorize(current.source.projectAuthority!)
  })
  const settled = pending.then(
    () => ({ allowed: true }),
    () => ({ allowed: false }),
  )
  try {
    await ready.promise
    await grant(input, false)
  } finally {
    release.resolve()
  }
  expect(await settled).toEqual({ allowed: false })
  expect(requests).toEqual([])
})

test("a denied host folder record remains restrictive after native repository consent", async () => {
  await using tmp = await tmpdir({ git: true })
  const input = await fixture(tmp.path)
  await grant(input)
  const current = await captured(input)
  await Bun.write(
    path.join(input.home, "trusted_folders.toml"),
    `[folders.${JSON.stringify(input.nested)}]\ntrusted=false\n`,
  )
  expect((await HookProjectTrust.inspect(input.data, input.proof, input.home)).trusted).toBe(true)
  expect((await HookProjectTrust.inspect(input.data, input.proof, input.home)).allowed).toBe(false)
  await expect(run(input, current)).rejects.toThrow()
  expect(
    (await HostHooks.discover(input.nested, input.home, input.home, { proof: input.proof, data: input.data })).sources,
  ).toHaveLength(0)
})

test("concurrent consent writes retain unrelated repository decisions", async () => {
  await using first = await tmpdir({ git: true })
  await using second = await tmpdir({ git: true })
  const one = await fixture(first.path)
  const two = { ...(await fixture(second.path)), data: one.data }
  await Promise.all([grant(one), grant(two)])
  expect((await HookProjectTrust.inspect(one.data, one.proof)).trusted).toBe(true)
  expect((await HookProjectTrust.inspect(two.data, two.proof)).trusted).toBe(true)
})

test("consent queued behind the store lock cannot publish after its owner is released", async () => {
  await using tmp = await tmpdir({ git: true })
  const input = await fixture(tmp.path)
  await grant(input, false)
  const preview = await HookProjectTrust.inspect(input.data, input.proof)
  const target = HookProjectTrust.file(input.data)
  const before = await readFile(target, "utf8")
  const lock = await Flock.acquire(target, {
    dir: path.join(path.dirname(target), ".locks"),
    timeoutMs: 5000,
    reclaimDeadOwner: true,
  })
  const owner = { active: true }
  const pending = HookProjectTrust.change(input.data, input.proof, { ...preview, trusted: true }, () => owner.active)
  const result = pending.then(
    () => true,
    () => false,
  )
  owner.active = false
  await lock.release()
  expect(await result).toBe(false)
  expect(await readFile(target, "utf8")).toBe(before)
})
