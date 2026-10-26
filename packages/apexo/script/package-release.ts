#!/usr/bin/env bun

import { $ } from "bun"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Script } from "@apexo/script"

const root = path.resolve(import.meta.dirname, "../../..")
const directory = path.join(root, "packages/apexo/dist")
const name = process.env.APEXO_NPM_PACKAGE ?? "apexo-code"
const targets = (await Array.fromAsync(new Bun.Glob("apexo-*/package.json").scan({ cwd: directory }))).sort()
if (!/^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(name)) throw new Error(`Invalid npm package name: ${name}`)
if (!targets.length || (!process.argv.includes("--single") && targets.length !== 12))
  throw new Error(`Expected 12 CLI targets, found ${targets.length}`)

await mkdir(path.join(directory, "npm/cli/bin"), { recursive: true })
await Bun.write(path.join(directory, "npm/cli/bin/apexo"), Bun.file(path.join(root, "packages/apexo/bin/apexo")))
await $`chmod +x ${path.join(directory, "npm/cli/bin/apexo")}`
await Bun.write(path.join(directory, "npm/cli/LICENSE"), Bun.file(path.join(root, "LICENSE")))
await Bun.write(path.join(directory, "npm/cli/README.md"), Bun.file(path.join(root, "README.md")))

const packages = await Promise.all(
  targets.map(async (target) => {
    const location = path.join(directory, path.dirname(target))
    const pkg = await Bun.file(path.join(directory, target)).json()
    if (pkg.version !== Script.version) throw new Error(`Stale binary: ${pkg.name}@${pkg.version}`)
    pkg.name = name + path.basename(location).slice("apexo".length)
    pkg.files = ["bin"]
    pkg.license = "MIT"
    pkg.repository = { type: "git", url: "git+https://github.com/cluster1900/apexo-code.git" }
    await Bun.write(path.join(directory, target), JSON.stringify(pkg, null, 2) + "\n")
    await Bun.write(path.join(location, "LICENSE"), Bun.file(path.join(root, "LICENSE")))
    const packed = await $`npm pack --json --ignore-scripts --pack-destination ${path.join(directory, "npm")}`
      .cwd(location)
      .quiet()
      .json()
    const archive = path.join(directory, `${path.basename(location)}.${pkg.os[0] === "linux" ? "tar.gz" : "zip"}`)
    if (pkg.os[0] === "linux") await $`tar -czf ${archive} .`.cwd(path.join(location, "bin"))
    if (pkg.os[0] !== "linux") await $`zip -qr ${archive} .`.cwd(path.join(location, "bin"))
    return {
      name: pkg.name as string,
      filename: packed[0].filename as string,
      integrity: packed[0].integrity as string,
    }
  }),
)

await Bun.write(
  path.join(directory, "npm/cli/package.json"),
  JSON.stringify(
    {
      name,
      version: Script.version,
      description: "Apexo coding agent CLI",
      type: "module",
      license: "MIT",
      repository: { type: "git", url: "git+https://github.com/cluster1900/apexo-code.git" },
      bin: { apexo: "bin/apexo" },
      files: ["bin"],
      engines: { node: ">=22" },
      optionalDependencies: Object.fromEntries(packages.map((pkg) => [pkg.name, Script.version])),
    },
    null,
    2,
  ) + "\n",
)
const packed = await $`npm pack --json --ignore-scripts --pack-destination ${path.join(directory, "npm")}`
  .cwd(path.join(directory, "npm/cli"))
  .quiet()
  .json()
packages.push({ name, filename: packed[0].filename, integrity: packed[0].integrity })
await Bun.write(
  path.join(directory, "npm/manifest.json"),
  JSON.stringify({ version: Script.version, packages }, null, 2),
)
console.log(`Prepared ${packages.length} npm packages and ${targets.length} CLI archives for ${Script.version}`)
