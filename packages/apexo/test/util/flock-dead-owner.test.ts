import { expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import path from "node:path"
import { Flock } from "@apexo/core/util/flock"
import { Hash } from "@apexo/core/util/hash"

const fixture = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "apexo-flock-owner-"))
  const key = "native-memory-owner"
  const lock = path.join(dir, Hash.fast(key) + ".lock")
  return { dir, key, lock, close: () => rm(dir, { recursive: true, force: true }) }
}
const stale = async (lock: string, metadata: unknown) => {
  await mkdir(lock)
  await writeFile(path.join(lock, "meta.json"), JSON.stringify(metadata))
  await writeFile(path.join(lock, "heartbeat"), "")
  await utimes(path.join(lock, "heartbeat"), new Date(0), new Date(0))
}

test("dead-owner-only never evicts stale unknown, foreign, live, or permission-denied owners", async () => {
  const probe = (() => {
    try {
      process.kill(1, 0)
      return "live"
    } catch (error) {
      return error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "unknown"
    }
  })()
  expect(["live", "EPERM"]).toContain(probe)
  for (const metadata of [
    { token: "unknown" },
    { token: "foreign", pid: process.pid, hostname: hostname() + "-another-host" },
    { token: "live", pid: process.pid, hostname: hostname() },
    { token: "protected", pid: 1, hostname: hostname() },
  ]) {
    const f = await fixture()
    try {
      await stale(f.lock, metadata)
      await expect(
        Flock.acquire(f.key, {
          dir: f.dir,
          deadOwnerOnly: true,
          staleMs: 1,
          timeoutMs: 25,
          baseDelayMs: 5,
          maxDelayMs: 5,
        }),
      ).rejects.toThrow("Timed out waiting for lock")
      expect(JSON.parse(await readFile(path.join(f.lock, "meta.json"), "utf8"))).toEqual(metadata)
    } finally {
      await f.close()
    }
  }
})

test("verified local dead owner is reclaimed and simultaneous contenders retain mutual exclusion", async () => {
  const f = await fixture()
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `import {Flock} from ${JSON.stringify(import.meta.resolve("@apexo/core/util/flock"))}; await Flock.acquire(${JSON.stringify(f.key)}, {dir:${JSON.stringify(f.dir)}}); process.exit(0)`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  try {
    await using deadline = {
      [Symbol.asyncDispose]: async () => {
        child.kill()
        await child.exited
      },
    }
    expect(
      await Promise.race([
        child.exited,
        Bun.sleep(3000).then(() => {
          throw new Error("Lock child did not exit")
        }),
      ]),
    ).toBe(0)
    const previous = JSON.parse(await readFile(path.join(f.lock, "meta.json"), "utf8"))
    expect(previous.pid).toBe(child.pid)
    const active = { count: 0, maximum: 0 }
    await Promise.all(
      Array.from({ length: 3 }, () =>
        Flock.withLock(
          f.key,
          async () => {
            active.count++
            active.maximum = Math.max(active.maximum, active.count)
            await Bun.sleep(10)
            active.count--
          },
          { dir: f.dir, deadOwnerOnly: true, timeoutMs: 1000, baseDelayMs: 5, maxDelayMs: 10 },
        ),
      ),
    )
    expect(active.maximum).toBe(1)
  } finally {
    child.kill()
    await child.exited
    await f.close()
  }
})

test("ordinary callers retain elapsed-age stale recovery", async () => {
  const f = await fixture()
  try {
    await stale(f.lock, { token: "unknown" })
    const lease = await Flock.acquire(f.key, { dir: f.dir, staleMs: 1, timeoutMs: 100, baseDelayMs: 5 })
    expect(JSON.parse(await readFile(path.join(f.lock, "meta.json"), "utf8"))).toMatchObject({
      pid: process.pid,
      hostname: hostname(),
    })
    await lease.release()
  } finally {
    await f.close()
  }
})
