import { createHash } from "node:crypto"
import { chmod, cp, lstat, mkdir, mkdtemp, readdir, rm, rename } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const version = "1.3.1"
export const artifacts = {
  arm64: {
    target: "aarch64-apple-darwin",
    sha256: "9b7b7cfc74892eab46c2c85d6cb7dc4863bf8dab0a222cfcfb8ae4604c69c86c",
  },
  x64: {
    target: "x86_64-apple-darwin",
    sha256: "469da10cfb68928c58caff88b92b30526e0ca895ac06bc86b7f533b1d9b309b3",
  },
}
export const tools = [
  "desktop_status",
  "desktop_permissions",
  "desktop_version",
  "desktop_skills_get",
  "desktop_list_apps",
  "desktop_list_windows",
  "desktop_list_surfaces",
  "desktop_snapshot",
  "desktop_find",
  "desktop_get",
  "desktop_is",
  "desktop_click",
  "desktop_type",
  "desktop_set_value",
  "desktop_clear",
  "desktop_scroll",
  "desktop_screenshot",
]

// Public MCP names follow Apexo's documented naming contract; verify against the host in integration tests.
export function toolName(tool) {
  const server = "computer-use:desktop"
  const readable = `mcp_${server}_${tool}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 53)
  return `${readable}_${createHash("sha256")
    .update(JSON.stringify([server, tool]))
    .digest("hex")
    .slice(0, 10)}`
}

export function permissionProfile(effect = "ask") {
  if (effect !== "ask" && effect !== "allow") throw new Error("Unsupported profile effect")
  return {
    permissions: [{ action: "mcp_computer-use_desktop_*", resource: "*", effect: "deny" }],
    agents: { build: { permissions: tools.map((tool) => ({ action: toolName(tool), resource: "*", effect })) } },
  }
}

export function legacyPermissionProfile(effect = "ask") {
  const profile = permissionProfile(effect)
  return {
    permission: { "mcp_computer-use_desktop_*": "deny" },
    agent: {
      build: {
        permission: Object.fromEntries(profile.agents.build.permissions.map((rule) => [rule.action, rule.effect])),
      },
    },
  }
}

export async function build(options = {}) {
  const arch = options.arch ?? process.arch
  const artifact = artifacts[arch]
  if (!artifact) throw new Error(`Unsupported macOS architecture: ${arch}`)
  const source = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const output = resolve(options.output ?? join(source, "dist", `computer-use-darwin-${arch}`))
  if (await Bun.file(join(output, ".claude-plugin/plugin.json")).exists())
    throw new Error(`Bundle already exists; choose an empty output directory: ${output}`)
  const filename = `agent-desktop-v${version}-${artifact.target}.tar.gz`
  const url = `https://github.com/vercel-labs/agent-desktop/releases/download/v${version}/${filename}`
  const archive = options.archive ? resolve(options.archive) : join(source, ".cache", filename)
  if (!options.archive && !(await Bun.file(archive).exists())) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`)
    await Bun.write(archive, response)
  }
  if (
    createHash("sha256")
      .update(await Bun.file(archive).bytes())
      .digest("hex") !== artifact.sha256
  )
    throw new Error(`Archive checksum mismatch: ${archive}`)
  const files = ["agent-desktop", "agent-desktop-macos-helper"]
  const entries = Bun.spawnSync(["/usr/bin/tar", "-tzf", archive])
  if (
    entries.exitCode !== 0 ||
    entries.stdout.toString().trim().split("\n").sort().join("\n") !== files.toSorted().join("\n")
  )
    throw new Error("Unexpected upstream archive contents")
  const staging = await mkdtemp(join(tmpdir(), "apexo-computer-use-build-"))
  try {
    await mkdir(join(staging, "bin"))
    const extracted = Bun.spawnSync(["/usr/bin/tar", "-xzf", archive, "-C", join(staging, "bin"), ...files])
    if (extracted.exitCode !== 0) throw new Error("Archive extraction failed")
    for (const file of [".claude-plugin", ".mcp.json", "README.md", "skills", "licenses"])
      await cp(join(source, file), join(staging, file), { recursive: true })
    await cp(join(source, "bin/mcp"), join(staging, "bin/mcp"))
    await Promise.all(["mcp", ...files].map((file) => chmod(join(staging, "bin", file), 0o755)))
    await Bun.write(join(staging, "permissions.json"), JSON.stringify(permissionProfile(), null, 2) + "\n")
    await Bun.write(join(staging, "permissions-v1.json"), JSON.stringify(legacyPermissionProfile(), null, 2) + "\n")
    await Bun.write(
      join(staging, "UPSTREAM.json"),
      JSON.stringify({ version, arch, url, sha256: artifact.sha256 }, null, 2) + "\n",
    )
    const checksums = []
    for (const file of await readdir(staging, { recursive: true })) {
      const stat = await lstat(join(staging, file))
      if (stat.isDirectory()) continue
      if (!stat.isFile() || stat.size > 20_000_000) throw new Error(`Unsupported bundle entry: ${file}`)
      checksums.push({
        file,
        size: stat.size,
        hash: createHash("sha256")
          .update(await Bun.file(join(staging, file)).bytes())
          .digest("hex"),
      })
    }
    if (checksums.length + 1 > 20_000 || checksums.reduce((sum, file) => sum + file.size, 0) > 199_900_000)
      throw new Error("Bundle exceeds PluginStore limits")
    await Bun.write(
      join(staging, "SHA256SUMS"),
      checksums
        .toSorted((a, b) => a.file.localeCompare(b.file))
        .map((file) => `${file.hash}  ${file.file}`)
        .join("\n") + "\n",
    )
    await mkdir(dirname(output), { recursive: true })
    // Copy to an adjacent temporary directory so publication is atomic across filesystems.
    const pending = await mkdtemp(join(dirname(output), ".computer-use-"))
    try {
      await cp(staging, pending, { recursive: true })
      await rename(pending, output)
    } finally {
      await rm(pending, { recursive: true, force: true })
    }
    return output
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (
    args.length % 2 ||
    args.filter((_, i) => i % 2 === 0).some((arg) => !["--arch", "--output", "--archive"].includes(arg))
  )
    throw new Error(
      "Usage: bun script/build.mjs [--arch arm64|x64] [--output directory] [--archive verified-release.tar.gz]",
    )
  const options = Object.fromEntries(args.flatMap((arg, i) => (i % 2 === 0 ? [[arg.slice(2), args[i + 1]]] : [])))
  console.log(await build(options))
}
