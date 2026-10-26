#!/usr/bin/env bun

import { $ } from "bun"
import path from "node:path"

// The launcher is last, so users never resolve a version with missing platform packages.
const directory = path.resolve(import.meta.dirname, "../dist/npm")
const manifest = await Bun.file(path.join(directory, "manifest.json")).json()
if (manifest.packages.length !== 13)
  throw new Error("Publishing requires all 12 platform packages and the CLI launcher")
for (const pkg of manifest.packages as { name: string; filename: string; integrity: string }[]) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${manifest.version}`)
  if (response.ok) {
    const existing = await response.json()
    if (existing.dist.integrity !== pkg.integrity) throw new Error(`Published content differs: ${pkg.name}`)
    console.log(`Already published: ${pkg.name}@${manifest.version}`)
    continue
  }
  if (response.status !== 404) throw new Error(`Registry returned ${response.status} for ${pkg.name}`)
  await $`npm publish ${path.join(directory, pkg.filename)} --access public --tag latest --ignore-scripts`
}
