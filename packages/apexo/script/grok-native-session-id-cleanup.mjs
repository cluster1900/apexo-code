import assert from "node:assert/strict"
import { startShellFixture } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const fixture = await startShellFixture(kind)
const checks = []
try {
  for (const id of ["ses_media_reused", "ses_custom-session", "ses_中文"]) {
    for (const lifetime of [1, 2]) {
      const created = await fixture.api("/api/session", { id, location: { directory: fixture.directory } })
      assert.equal(created.data.id, id)
      const url = new URL(`/api/session/${encodeURIComponent(id)}`, fixture.url)
      url.searchParams.set("directory", fixture.directory)
      const deleted = await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(15000) })
      assert.equal(deleted.status, 204, await deleted.text())
      const missing = await fetch(url, { signal: AbortSignal.timeout(15000) })
      assert.equal(missing.status, 404)
      await missing.text()
      checks.push(`${id}-lifetime-${lifetime}-created-deleted-and-absent`)
    }
  }
  assert.equal(fixture.calls.length, 0)
  console.log(JSON.stringify({ kind, checks, providerCalls: fixture.calls.length, output: fixture.output }, null, 2))
} finally {
  await fixture.close()
}
