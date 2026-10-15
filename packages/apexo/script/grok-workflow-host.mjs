// Workflow host operations against Apexo's real CLI or rebuilt Desktop backend.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const checks = []
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  next: () => {
    throw new Error("Host-only Workflow must not request model execution")
  },
})
const git = (...args) => execFileSync("git", args, { cwd: fixture.directory, encoding: "utf8" }).trim()
const idle = () =>
  poll(async () => Object.keys((await fixture.api("/api/session/active")).data).length === 0, "Workflow host idle")
try {
  const templates = join(fixture.directory, ".apexo", "workflows", "templates")
  const secret = join(fixture.directory, "secret.txt")
  const outside = join(fixture.output, "private-template.txt")
  await mkdir(templates, { recursive: true })
  await writeFile(join(templates, "allowed.txt"), "Hello {{name}}; {{data}}; {{missing}}")
  await writeFile(join(templates, "denied.txt"), "DENIED_TEMPLATE_MARKER")
  await writeFile(outside, "DENIED_OUTSIDE_MARKER")
  await symlink(outside, join(templates, "linked.txt"))
  const config = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT)
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      ...config,
      agent: {
        restricted: {
          permission: {
            "*": "allow",
            read: {
              "*": "allow",
              [secret]: "deny",
              [await realpath(outside)]: "deny",
              [join(templates, "denied.txt")]: "deny",
            },
          },
        },
      },
    }),
  )
  git("init", "--initial-branch=fixture")
  await writeFile(join(fixture.directory, "public.txt"), "public before\n")
  await writeFile(secret, "secret before\n")
  git("add", "public.txt", "secret.txt")
  git(
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture baseline",
  )
  const baseline = git("rev-parse", "HEAD")
  await writeFile(join(fixture.directory, "public.txt"), "PUBLIC_CHANGE_MARKER\n")
  await writeFile(secret, "DENIED_CHANGE_MARKER\n")
  const beforeIndex = await readFile(join(fixture.directory, ".git", "index"))
  const parent = (
    await fixture.api("/api/session", {
      location: { directory: fixture.directory },
      model: { providerID: "xai", id: "grok-4.7" },
      agent: "restricted",
    })
  ).data
  const root = `/api/session/${parent.id}/workflow`
  const run = async (name, script) => {
    const started = await fixture.api(root, { source: { type: "script", name, script }, agentBudget: 1 })
    const result = await poll(async () => {
      const info = await fixture.api(`${root}/${started.id}`)
      return ["pending", "running"].includes(info.status) ? undefined : info
    }, `Workflow host ${name}`)
    await idle()
    assert.equal(result.agentsSpent, 0)
    assert.deepEqual(result.children, [])
    return result
  }
  const rendered = await run("render", 'complete(render_template("allowed.txt", #{name:"世界",data:#{ok:true}}));')
  assert.equal(rendered.status, "completed", rendered.message)
  assert.equal(rendered.result, 'Hello 世界; {"ok":true}; null')
  checks.push("template-interpolates-text-json-and-missing-values-without-model-work")
  for (const name of ["denied.txt", "linked.txt", "../private-template.txt"]) {
    const result = await run("denied", `complete(render_template(${JSON.stringify(name)}, #{}));`)
    assert.equal(result.status, "failed", `${name}: ${JSON.stringify(result)}`)
    assert.ok(!JSON.stringify(result).includes("DENIED_"))
  }
  checks.push("template-rejects-denied-path-resolved-symlink-and-traversal")
  const diff = await run("diff", `complete(git_diff_since("${baseline}"));`)
  assert.equal(diff.status, "completed", diff.message)
  assert.ok(diff.result.includes("PUBLIC_CHANGE_MARKER"))
  assert.ok(!diff.result.includes("DENIED_CHANGE_MARKER"))
  checks.push("git-diff-filters-agent-denied-content")
  await fixture.api(
    `/session/${parent.id}`,
    { permission: [{ permission: "read", pattern: "*", action: "allow" }] },
    "PATCH",
  )
  const widened = await run("diff-authority", `complete(git_diff_since("${baseline}"));`)
  assert.equal(widened.status, "completed", widened.message)
  assert.ok(widened.result.includes("PUBLIC_CHANGE_MARKER"))
  assert.ok(
    !widened.result.includes("DENIED_CHANGE_MARKER"),
    "Session grants must not override a configured agent denial",
  )
  checks.push("git-diff-preserves-agent-denial-despite-session-grant")
  const deniedAgain = await run("template-authority", 'complete(render_template("denied.txt", #{}));')
  assert.equal(deniedAgain.status, "failed")
  checks.push("template-preserves-agent-denial-despite-session-grant")
  const invalid = await run("invalid-revision", 'complete(git_diff_since("--output=unwanted"));')
  assert.equal(invalid.status, "failed")
  assert.deepEqual(await readFile(join(fixture.directory, ".git", "index")), beforeIndex)
  checks.push("git-rejects-options-and-preserves-index-bytes")
  console.log(JSON.stringify({ checks, providerCalls: fixture.calls.length, output: fixture.output }, null, 2))
} finally {
  await fixture.close()
  await writeFile(join(fixture.output, "workflow-host.json"), JSON.stringify({ checks }, null, 2))
}
