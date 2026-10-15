import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRuntimeProfile } from "./runtime-profile"

test("profile preference persists without changing the active backend until next launch", () => {
  const directory = mkdtempSync(join(tmpdir(), "apexo-profile-test-"))
  const file = join(directory, "profile.json")
  writeFileSync(file, "null")
  const storage = {
    read: () => JSON.parse(readFileSync(file, "utf8")),
    write: (profile: string) => writeFileSync(file, JSON.stringify(profile)),
    supported: true,
    environment: "apexo",
  }
  const running = createRuntimeProfile(storage)
  expect(running.get()).toEqual({ active: "apexo", preferred: "apexo", supported: true })
  expect(running.set("grok-build")).toEqual({ active: "apexo", preferred: "grok-build", supported: true })
  const reopened = createRuntimeProfile(storage)
  expect(reopened.get()).toEqual({ active: "grok-build", preferred: "grok-build", supported: true })
  expect(() => running.set("official-rust")).toThrow("Invalid runtime profile")
  expect(reopened.get().preferred).toBe("grok-build")
  rmSync(directory, { recursive: true })
})

test("background service does not claim an active profile or accept selection", () => {
  const service = createRuntimeProfile({
    read: () => "grok-build",
    write: () => {
      throw new Error("must not write")
    },
    environment: "apexo",
    supported: false,
  })
  expect(service.get()).toEqual({ active: null, preferred: "grok-build", supported: false })
  expect(() => service.set("apexo")).toThrow("bundled local backend")
})

test("without a valid stored preference the launch environment remains the default", () => {
  const profile = createRuntimeProfile({
    read: () => "invalid",
    write: () => {},
    environment: "grok-build",
    supported: true,
  })
  expect(profile.get().active).toBe("grok-build")
})
