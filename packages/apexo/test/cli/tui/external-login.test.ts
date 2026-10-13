import { expect, test } from "bun:test"
import path from "node:path"
import { externalLogin } from "../../../../tui/src/external-login"
import { tmpdir } from "../../fixture/fixture"

function terminal() {
  const calls: string[] = []
  return {
    calls,
    renderer: {
      suspend: () => {
        calls.push("suspend")
      },
      resume: () => {
        calls.push("resume")
      },
      requestRender: () => {
        calls.push("render")
      },
      currentRenderBuffer: {
        clear: () => {
          calls.push("clear")
        },
      },
    },
  }
}

test("an existing native login never starts another login command", async () => {
  const view = terminal()
  expect(
    await externalLogin({
      command: ["nonexistent-login-command"],
      renderer: view.renderer,
      connect: async () => true,
    }),
  ).toBe(true)
  expect(view.calls).toEqual([])
})

test("starts native login once, detects its saved login and returns to Apexo automatically", async () => {
  await using dir = await tmpdir()
  const view = terminal()
  const file = path.join(dir.path, "native-session")
  const exited = path.join(dir.path, "exited")
  expect(
    await externalLogin({
      command: [
        process.execPath,
        "-e",
        `
      process.on("SIGTERM", async () => {
        await Bun.write(${JSON.stringify(exited)}, "closed");
        process.exit(0);
      });
      await Bun.write(${JSON.stringify(file)}, String(process.pid));
      setInterval(() => {}, 1000);
    `,
      ],
      renderer: view.renderer,
      connect: async () => Bun.file(file).exists(),
      stdio: "ignore",
      intervalMs: 20,
    }),
  ).toBe(true)
  expect(await Bun.file(exited).text()).toBe("closed")
  expect(view.calls).toEqual(["suspend", "clear", "clear", "resume", "render"])
})

test("cancelling native login restores Apexo without reporting a connection", async () => {
  const view = terminal()
  expect(
    await externalLogin({
      command: [process.execPath, "-e", "process.exit(0)"],
      renderer: view.renderer,
      connect: async () => false,
      stdio: "ignore",
      intervalMs: 20,
    }),
  ).toBe(false)
  expect(view.calls.slice(-2)).toEqual(["resume", "render"])
})

test("missing native binaries restore the terminal after an error", async () => {
  const view = terminal()
  await expect(
    externalLogin({
      command: ["nonexistent-native-login-binary"],
      renderer: view.renderer,
      connect: async () => false,
      stdio: "ignore",
    }),
  ).rejects.toThrow()
  expect(view.calls.slice(-2)).toEqual(["resume", "render"])
})

test("an aborted login stops its child and restores the terminal", async () => {
  await using dir = await tmpdir()
  const view = terminal()
  const file = path.join(dir.path, "started")
  const exited = path.join(dir.path, "exited")
  const controller = new AbortController()
  await expect(
    externalLogin({
      command: [
        process.execPath,
        "-e",
        `
      process.on("SIGTERM", async () => {
        await Bun.write(${JSON.stringify(exited)}, "closed");
        process.exit(0);
      });
      await Bun.write(${JSON.stringify(file)}, "started");
      setInterval(() => {}, 1000);
    `,
      ],
      renderer: view.renderer,
      connect: async (signal) => {
        if (await Bun.file(file).exists()) controller.abort(new Error("Cancelled"))
        signal.throwIfAborted()
        return false
      },
      signal: controller.signal,
      stdio: "ignore",
      intervalMs: 20,
    }),
  ).rejects.toThrow("Cancelled")
  expect(await Bun.file(exited).text()).toBe("closed")
  expect(view.calls.slice(-2)).toEqual(["resume", "render"])
})

test("connection errors do not start another login", async () => {
  const view = terminal()
  await expect(
    externalLogin({
      command: ["nonexistent-login-command"],
      renderer: view.renderer,
      connect: async () => {
        throw new Error("Network unavailable")
      },
    }),
  ).rejects.toThrow("Network unavailable")
  expect(view.calls).toEqual([])
})
