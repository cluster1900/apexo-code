import { expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"

const arboristSignals = require.resolve("@npmcli/arborist/lib/signal-handling.js", {
  paths: [path.dirname(require.resolve("@apexo/core/npm"))],
})
const guard = path.resolve(import.meta.dir, "../../../core/src/npm-signals.ts")

// A listening server keeps the loop alive, like `apexo serve`; reify never settles, like a stalled install.
async function survivesSigterm(guarded: boolean) {
  await using dir = await tmpdir()
  const script = path.join(dir.path, "child.ts")
  await Bun.write(
    script,
    `const setup = require(${JSON.stringify(arboristSignals)})
const { withSignalPassthrough } = await import(${JSON.stringify(guard)})
Bun.serve({ port: 0, fetch: () => new Response("ok") })
const reify = () => new Promise(() => { setup(() => {}) })
${guarded ? "withSignalPassthrough(reify)" : "reify()"}
setTimeout(() => console.log("ready"), 100)
`,
  )
  const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "inherit" })
  const reader = child.stdout.getReader()
  await reader.read()
  child.kill("SIGTERM")
  const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(3000).then(() => false)])
  if (!exited) child.kill("SIGKILL")
  await child.exited
  return { exited, signal: child.signalCode }
}

test("SIGTERM during an in-flight npm reify terminates a serving process", async () => {
  expect(await survivesSigterm(true)).toEqual({ exited: true, signal: "SIGTERM" })
}, 20_000)

test("without the guard, Arborist swallows SIGTERM while a server is listening (regression proof)", async () => {
  expect((await survivesSigterm(false)).exited).toBe(false)
}, 20_000)
