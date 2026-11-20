import assert from "node:assert/strict"
import { constants } from "node:fs"
import { access, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { legacyPermissionProfile, permissionProfile } from "../../../plugins/computer-use/script/build.mjs"
import { startComputerUseFixture } from "./computer-use-fixture.mjs"
import { startPackagedSaveDesktop } from "./computer-use-save-desktop.mjs"
import { runLiveTextEditSave } from "./computer-use-save-live.mjs"
import { prepareSaveSpaceSwitch } from "./computer-use-save-spaces.mjs"
import { openSaveTerminal } from "./computer-use-save-terminal.mjs"

const surfaces = ["desktop", "cli", "tui"]
const target = process.argv[2] ?? "all"
const scenario = process.argv[3] ?? "all"
assert.ok(
  process.argv.length <= 4 && ["all", ...surfaces].includes(target) && ["all", "series", "recovery"].includes(scenario),
  "Usage: bun script/computer-use-save-e2e.mjs [all|desktop|cli|tui] [all|series|recovery]",
)
assert.equal(process.platform, "darwin", "The Save regression requires a macOS graphical session")
const repo = resolve(import.meta.dir, "../../..")
const plugin = join(repo, "plugins/computer-use")
const catalog = join(plugin, "catalog")
const app = resolve(
  process.env.COMPUTER_USE_DESKTOP_APP ??
    join(repo, "packages/desktop/dist", process.arch === "arm64" ? "mac-arm64" : "mac", "Apexo Dev.app"),
)
const cli = resolve(
  process.env.COMPUTER_USE_CLI ?? join(repo, `packages/apexo/dist/apexo-darwin-${process.arch}/bin/apexo`),
)
const output = await mkdtemp(join(tmpdir(), "apexo-computer-use-save-"))
console.log(JSON.stringify({ stage: "starting", target, scenario, output }))

const checkout = join(output, "release")
const verify = Bun.spawnSync(["/bin/sh", join(plugin, "script/verify-catalog.sh"), checkout], { timeout: 90_000 })
assert.equal(verify.exitCode, 0, verify.stderr.toString() || "Catalog verification failed")
const marketplace = await Bun.file(join(catalog, ".grok-plugin/marketplace.json")).json()
const entry = marketplace.plugins.find((item) => item.name === "computer-use")
const bundle = join(checkout, entry.source.path)
const legacyProfile = await Bun.file(join(bundle, "permissions-v1.json")).json()
assert.deepEqual(legacyProfile, legacyPermissionProfile())
assert.deepEqual(await Bun.file(join(bundle, "permissions.json")).json(), permissionProfile())
const release = { catalog, bundle, legacyProfile, version: entry.version, sha: entry.source.sha }
const switchSpace = scenario === "series" ? undefined : await prepareSaveSpaceSwitch(output)
const cases = [...(scenario === "recovery" ? [] : [1, 2, 3]), ...(switchSpace ? ["recovery"] : [])]
const results = []
const failures = []

for (const kind of target === "all" ? surfaces : [target]) {
  let fixture
  try {
    if (kind === "desktop") fixture = await startPackagedSaveDesktop(app, release, output)
    if (kind !== "desktop") {
      await access(cli, constants.X_OK)
      fixture = await startComputerUseFixture("cli", {
        live: true,
        releasePermissions: true,
        bundle,
        catalog,
        executable: cli,
        outputRoot: output,
      })
      const installed = await fixture.install()
      assert.equal(installed?.installedRevision, release.sha)
      assert.equal(installed?.installedVersion, release.version)
      const models = await fixture.client.models.list({ location: fixture.location })
      assert.ok(
        models.data.some((model) => model.id === "grok-4.7" && model.providerID === "xai"),
        "The CLI must use an existing xAI sign-in",
      )
    }
    console.log(
      JSON.stringify({
        stage: "ready",
        kind,
        output: fixture.runtime.output,
        revision: release.sha,
        version: release.version,
      }),
    )
    for (const run of cases) {
      console.log(JSON.stringify({ stage: "running", kind, run }))
      try {
        const result = await runLiveTextEditSave(fixture, run, {
          openInput: fixture.openInput ?? ((id) => openSaveTerminal(kind, fixture, cli, id, run)),
          switchSpace: run === "recovery" ? switchSpace : undefined,
        })
        results.push({ kind, ...result })
      } catch (error) {
        reportFailure(kind, run, error)
      }
    }
  } catch (error) {
    reportFailure(kind, "setup", error)
  } finally {
    await fixture?.runtime.close().catch((error) => reportFailure(kind, "cleanup", error))
  }
}

await Bun.write(
  join(output, "result.json"),
  JSON.stringify({ target, scenario, revision: release.sha, results, failures }, null, 2),
)
console.log(JSON.stringify({ stage: "complete", passed: results.length, failed: failures.length, output }))
if (failures.length) process.exitCode = 1

function reportFailure(kind, run, error) {
  const failure = { kind, run, error: error.message }
  failures.push(failure)
  console.error(JSON.stringify({ stage: "failed", ...failure }))
}
