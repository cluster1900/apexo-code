import { promises } from "node:fs"
import path from "node:path"

// A child-only crash-point observer delegates the real filesystem rename first.
// No product hooks or provider mocks are involved.
const home = process.argv[2]!
const phase = process.argv[3]!
const target = process.argv[4]!
const rename = promises.rename
promises.rename = async (source, destination) => {
  await rename(source, destination)
  if (
    (phase === "prepared" && String(destination).endsWith(".pending")) ||
    (phase === "published" && destination === target)
  ) {
    await promises.writeFile(path.join(home, "checkpoint"), phase)
    await new Promise(() => {})
  }
}
const { WorkspaceMemory } = await import("@apexo/core/workspace-memory")
const preview = await WorkspaceMemory.migrationSnapshot(home, home, { projectID: "stable-project" }, true)
await WorkspaceMemory.migrate(home, home, { projectID: "stable-project" }, () => true, preview)
