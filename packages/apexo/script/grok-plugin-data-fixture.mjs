import assert from "node:assert/strict"
import { join } from "node:path"
import { poll, deadline } from "./grok-shell-fixture.mjs"

// A real independent reader whose joined release produces a catalog without retainedData.
export async function holdPluginData(runtime) {
  const marker = join(runtime.output, "plugin-data-reader")
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `import ${JSON.stringify(import.meta.resolve("@apexo/core/global"))};import {PluginStore} from ${JSON.stringify(import.meta.resolve("@apexo/core/plugin-store"))};const captured=await PluginStore.capture(${JSON.stringify(join(runtime.env.XDG_DATA_HOME, "apexo/plugins"))});await Bun.write(${JSON.stringify(marker)},'ready');process.stdin.once('data',async()=>{await captured.release();process.exit(0)});process.stdin.resume();`,
    ],
    { env: runtime.env, cwd: runtime.output, stdin: "pipe", stdout: "ignore", stderr: "pipe" },
  )
  await poll(() => Bun.file(marker).exists(), "independent plugin reader ready", 10000).catch(async (error) => {
    child.kill("SIGKILL")
    await child.exited
    throw error
  })
  return async () => {
    child.stdin.write("release\n")
    child.stdin.end()
    const exit = await deadline(child.exited, 10000, "independent reader release").catch(async (error) => {
      child.kill("SIGKILL")
      await child.exited
      throw error
    })
    assert.equal(exit, 0, await new Response(child.stderr).text())
  }
}
