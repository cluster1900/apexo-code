import { test, expect } from "bun:test"
import { mkdtemp, rm, readFile, writeFile, chmod, stat } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { McpOAuthStore } from "@apexo/core/mcp-oauth-store"
import { Flock } from "@apexo/core/util/flock"
const credentials = {
  issuer: "https://issuer.example",
  clientId: "fixture",
  accessToken: "access",
  refreshToken: "refresh",
}
const setup = async () => {
  const data = await mkdtemp(path.join(tmpdir(), "apexo-oauth-store-"))
  return {
    data,
    store: McpOAuthStore.make(data),
    close: () => rm(data, { recursive: true, force: true }),
  }
}
test("private credentials preserve full identity and never use identifiers as paths", async () => {
  const f = await setup()
  try {
    expect(await f.store.read("first")).toEqual({})
    await f.store.transaction(
      "first",
      new AbortController().signal,
      () => true,
      async (_, commit) => commit(credentials),
    )
    expect((await f.store.read("first")).credentials).toEqual(credentials)
    expect(await f.store.read("../__proto__?different")).toEqual({})
    expect((await stat(McpOAuthStore.file(f.data, "first"))).mode & 0o777).toBe(0o600)
    expect(path.basename(McpOAuthStore.file(f.data, "../__proto__"))).toMatch(/^[0-9a-f]{64}\.json$/)
  } finally {
    await f.close()
  }
})
test("corrupt and permissive storage fails closed without replacement", async () => {
  const f = await setup()
  try {
    await f.store.transaction(
      "first",
      new AbortController().signal,
      () => true,
      async (_, commit) => commit(credentials),
    )
    const file = McpOAuthStore.file(f.data, "first")
    await writeFile(file, "{")
    await expect(f.store.read("first")).rejects.toBeInstanceOf(McpOAuthStore.Failure)
    await expect(
      f.store.transaction(
        "first",
        new AbortController().signal,
        () => true,
        async (_, commit) => commit(credentials),
      ),
    ).rejects.toBeInstanceOf(McpOAuthStore.Failure)
    expect(await readFile(file, "utf8")).toBe("{")
    await chmod(file, 0o644)
    await expect(f.store.read("first")).rejects.toBeInstanceOf(McpOAuthStore.Failure)
  } finally {
    await f.close()
  }
})
test("concurrent transactions see latest rotation; later failure does not roll it back", async () => {
  const f = await setup()
  try {
    const observed: string[] = []
    await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        f.store.transaction(
          "first",
          new AbortController().signal,
          () => true,
          async (current, commit) => {
            observed.push(current.credentials?.refreshToken ?? "missing")
            return commit({ ...credentials, refreshToken: String(index) })
          },
        ),
      ),
    )
    expect(observed.filter((x) => x === "missing")).toHaveLength(1)
    await expect(
      f.store.transaction(
        "first",
        new AbortController().signal,
        () => true,
        async (_, commit) => {
          await commit({ ...credentials, refreshToken: "forward" })
          throw new Error("later transport failure")
        },
      ),
    ).rejects.toThrow("later transport failure")
    expect((await f.store.read("first")).credentials?.refreshToken).toBe("forward")
  } finally {
    await f.close()
  }
})
test("waiting cancellation releases immediately; acquired cancellation always releases", async () => {
  const f = await setup()
  try {
    const lease = await Flock.acquire(McpOAuthStore.file(f.data, "first"), {
      dir: path.join(f.data, "mcp-oauth/.locks"),
      timeoutMs: 1000,
    })
    const abort = new AbortController()
    const waiting = f.store.transaction(
      "first",
      abort.signal,
      () => true,
      async () => {
        throw new Error("must not enter")
      },
    )
    abort.abort()
    await expect(waiting).rejects.toBeInstanceOf(McpOAuthStore.Failure)
    await lease.release()
    const second = new AbortController()
    await expect(
      f.store.transaction(
        "first",
        second.signal,
        () => true,
        async (_, commit) => {
          second.abort()
          await commit(credentials)
        },
      ),
    ).rejects.toBeInstanceOf(McpOAuthStore.Failure)
    await f.store.transaction(
      "first",
      new AbortController().signal,
      () => true,
      async (_, commit) => commit(credentials),
    )
    expect((await f.store.read("first")).credentials).toEqual(credentials)
  } finally {
    await f.close()
  }
})
test("retired identity and replacement observed before publication are rejected", async () => {
  const f = await setup()
  try {
    await f.store.transaction(
      "first",
      new AbortController().signal,
      () => true,
      async (_, commit) => commit(credentials),
    )
    let active = true
    await expect(
      f.store.transaction(
        "first",
        new AbortController().signal,
        () => active,
        async (_, commit) => {
          active = false
          await commit({ ...credentials, accessToken: "stale" })
        },
      ),
    ).rejects.toBeInstanceOf(McpOAuthStore.Failure)
    const file = McpOAuthStore.file(f.data, "first")
    await expect(
      f.store.transaction(
        "first",
        new AbortController().signal,
        () => true,
        async (_, commit) => {
          const latest = JSON.parse(await readFile(file, "utf8"))
          latest.revision = "newer-writer"
          latest.credentials.accessToken = "newer"
          await writeFile(file, JSON.stringify(latest))
          await commit({ ...credentials, accessToken: "stale" })
        },
      ),
    ).rejects.toBeInstanceOf(McpOAuthStore.Failure)
    expect((await f.store.read("first")).credentials?.accessToken).toBe("newer")
  } finally {
    await f.close()
  }
})
test("known successful rotation commits after cancellation under its original lease", async () => {
  const f = await setup()
  try {
    const signal = new AbortController()
    await f.store.transaction(
      "first",
      signal.signal,
      () => true,
      async (_, commit) => {
        signal.abort()
        await commit({ ...credentials, refreshToken: "known-rotation" }, true)
      },
    )
    expect((await f.store.read("first")).credentials?.refreshToken).toBe("known-rotation")
  } finally {
    await f.close()
  }
})

test("separate processes serialize private credential publication", async () => {
  const f = await setup()
  const workers = Array.from({ length: 2 }, () =>
    Bun.spawn([process.execPath, path.join(import.meta.dir, "../fixture/mcp-oauth-store-worker.ts"), f.data], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    }),
  )
  try {
    const results = await Promise.all(
      workers.map(async (worker) => {
        const [code, stdout, stderr] = await Promise.all([
          worker.exited,
          new Response(worker.stdout).text(),
          new Response(worker.stderr).text(),
        ])
        expect(code).toBe(0)
        expect(stderr).toBe("")
        return JSON.parse(stdout) as { hadCredentials: boolean }
      }),
    )
    expect(results.filter((x) => !x.hadCredentials)).toHaveLength(1)
    expect((await f.store.read("shared-fixture")).credentials).toBeDefined()
  } finally {
    for (const worker of workers) {
      if (worker.exitCode === null) worker.kill()
      await worker.exited
    }
    await f.close()
  }
})
