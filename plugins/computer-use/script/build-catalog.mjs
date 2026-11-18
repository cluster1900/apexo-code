import { createHash } from "node:crypto"
import { chmod, cp, lstat, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { artifacts, build, version } from "./build.mjs"

const [destination, archives] = process.argv.slice(2)
if (!destination || process.argv.length > 4)
  throw new Error("Usage: bun script/build-catalog.mjs <new-output-directory> [verified-archive-directory]")

const plugin = resolve(import.meta.dir, "..")
const repo = resolve(plugin, "../..")
const output = resolve(destination)
const git = (...args) => {
  const result = Bun.spawnSync(["git", "-C", repo, ...args])
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || "Git command failed")
  return result.stdout.toString().trim()
}
const commit = git("rev-parse", "HEAD")
if (git("status", "--porcelain", "--", "plugins/computer-use", "LICENSE"))
  throw new Error("Commit the plugin source and license before assembling a catalog release")
if (
  await lstat(output).catch((error) => {
    if (error.code !== "ENOENT") throw error
  })
)
  throw new Error("Bundle already exists: " + output)

await mkdir(dirname(output), { recursive: true })
const work = await mkdtemp(join(dirname(output), ".computer-use-catalog-"))
try {
  const staging = join(work, "bundle")
  await mkdir(join(staging, "bin"), { recursive: true })
  const bundles = await Promise.all(
    Object.entries(artifacts).map(async ([arch, artifact]) => {
      const directory = await build({
        arch,
        output: join(work, arch),
        ...(archives
          ? { archive: join(resolve(archives), "agent-desktop-v" + version + "-" + artifact.target + ".tar.gz") }
          : {}),
      })
      return { arch, directory, upstream: await Bun.file(join(directory, "UPSTREAM.json")).json() }
    }),
  )
  for (const file of [".claude-plugin", ".mcp.json", "licenses", "permissions.json", "permissions-v1.json", "skills"])
    await cp(join(bundles[0].directory, file), join(staging, file), { recursive: true })
  await cp(join(repo, "LICENSE"), join(staging, "licenses/apexo-LICENSE"))
  await cp(join(plugin, "README.md"), join(staging, "README.md"))
  await cp(join(plugin, "bin/mcp-catalog"), join(staging, "bin/mcp"))
  await chmod(join(staging, "bin/mcp"), 0o755)
  for (const bundle of bundles)
    await cp(join(bundle.directory, "bin"), join(staging, "bin", bundle.arch), { recursive: true })

  await Bun.write(
    join(staging, "UPSTREAM.json"),
    JSON.stringify({ apexoCommit: commit, artifacts: bundles.map((bundle) => bundle.upstream) }, null, 2) + "\n",
  )
  const checksums = []
  for (const file of (await readdir(staging, { recursive: true })).toSorted()) {
    const entry = await lstat(join(staging, file))
    if (entry.isDirectory()) continue
    if (!entry.isFile() || entry.size > 20_000_000) throw new Error("Unsupported bundle entry: " + file)
    const digest = createHash("sha256")
      .update(await Bun.file(join(staging, file)).bytes())
      .digest("hex")
    checksums.push({ file, digest, bytes: entry.size })
  }
  if (checksums.length + 1 > 20_000 || checksums.reduce((sum, item) => sum + item.bytes, 0) > 199_900_000)
    throw new Error("Bundle exceeds Apexo's plugin limits")
  await Bun.write(
    join(staging, "SHA256SUMS"),
    checksums.map((entry) => entry.digest + "  " + entry.file).join("\n") + "\n",
  )
  await rename(staging, output)
  console.log(output)
} finally {
  await rm(work, { recursive: true, force: true })
}
