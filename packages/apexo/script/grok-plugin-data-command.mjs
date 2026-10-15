import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, access } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
const output = await mkdtemp(join(tmpdir(), "apexo-plugin-data-command-"))
const env = {
  ...process.env,
  HOME: join(output, "home"),
  APEXO_TEST_HOME: join(output, "home"),
  APEXO_APP_DIR_NAME: "apexo",
  APEXO_DISABLE_MODELS_FETCH: "1",
}
for (const name of ["DATA", "CACHE", "CONFIG", "STATE"]) env[`XDG_${name}_HOME`] = join(output, name.toLowerCase())
await mkdir(env.HOME)
const source = join(output, "source")
await mkdir(join(source, "commands"), { recursive: true })
await writeFile(join(source, "plugin.json"), JSON.stringify({ name: "command-data" }))
await writeFile(join(source, "commands/state.md"), "Read persistent data")
const run = async (args) => {
  const child = Bun.spawn(
    [process.execPath, new URL("../src/index.ts", import.meta.url).pathname, "plugins", ...args],
    { env, cwd: output, stdout: "pipe", stderr: "pipe" },
  )
  const stdout = await new Response(child.stdout).text()
  const stderr = await new Response(child.stderr).text()
  assert.equal(await child.exited, 0, stderr)
  return { catalog: JSON.parse(stdout), stderr }
}
const installed = await run(["install", "--source", source, "--trust"])
const id = installed.catalog.items[0].id
const store = join(env.XDG_DATA_HOME, "apexo/plugins")
const capture = async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `import ${JSON.stringify(import.meta.resolve("@apexo/core/global"))};import {PluginStore} from ${JSON.stringify(import.meta.resolve("@apexo/core/plugin-store"))};const captured=await PluginStore.capture(${JSON.stringify(store)});const data=captured.plugins[0].data;await Bun.write(data+'/state','persistent');console.log(data);await captured.release();`,
    ],
    { env, cwd: output, stdout: "pipe", stderr: "pipe" },
  )
  const data = (await new Response(child.stdout).text()).trim()
  const errors = await new Response(child.stderr).text()
  assert.equal(await child.exited, 0, errors)
  return data
}
const data = await capture()
await run(["uninstall", id, "--keep-data"])
assert.equal(await readFile(join(data, "state"), "utf8"), "persistent")
await run(["install", "--source", source, "--trust"])
assert.equal(await capture(), data)
await run(["uninstall", id])
assert.equal(
  await access(join(data, "state")).then(
    () => true,
    () => false,
  ),
  false,
)
await run(["install", "--source", source, "--trust"])
const marker = join(output, "held-reader")
const held = Bun.spawn(
  [
    process.execPath,
    "--eval",
    `import ${JSON.stringify(import.meta.resolve("@apexo/core/global"))};import {PluginStore} from ${JSON.stringify(import.meta.resolve("@apexo/core/plugin-store"))};const captured=await PluginStore.capture(${JSON.stringify(store)});await Bun.write(${JSON.stringify(marker)}, captured.plugins[0].data);setInterval(()=>{},1000);`,
  ],
  { env, cwd: output, stdout: "ignore", stderr: "pipe" },
)
try {
  const until = Date.now() + 10000
  while (!(await Bun.file(marker).exists()) && Date.now() < until) await Bun.sleep(20)
  assert.equal(await Bun.file(marker).exists(), true, "owned reader did not become ready")
  const removed = await run(["uninstall", id])
  assert.deepEqual(removed.catalog.retainedData, [{ id, reason: "readers" }])
  assert.match(removed.stderr, /Plugins: data cleanup is deferred/)
} finally {
  held.kill("SIGKILL")
  await held.exited
}
console.log(
  JSON.stringify({
    output,
    checks: [
      "actual-cli-keep-data-option",
      "same-id-reinstall-retains-epoch",
      "default-cli-uninstall-cleans-unleased-data",
      "actual-cli-deferred-cleanup-message",
    ],
    passed: 4,
  }),
)
