import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/npm")
const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"))
const name = process.env.APEXO_NPM_PACKAGE ?? "apexo-code"
const platform = process.platform === "win32" ? "windows" : process.platform
const suffix = `${platform}-${process.arch}${process.arch === "x64" ? "-baseline" : ""}`
const binary = manifest.packages.find((pkg) => pkg.name === `${name}-${suffix}`)
const launcher = manifest.packages.find((pkg) => pkg.name === name)
if (!binary || !launcher) throw new Error(`Missing npm packages for ${suffix}`)

const prefix = mkdtempSync(path.join(tmpdir(), "apexo-npm-smoke-"))
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
execFileSync(
  npm,
  [
    "install",
    "--prefix",
    prefix,
    "--ignore-scripts",
    "--omit=optional",
    "--no-audit",
    "--no-fund",
    path.join(directory, binary.filename),
    path.join(directory, launcher.filename),
  ],
  { stdio: "inherit", shell: process.platform === "win32" },
)
const installed = path.join(prefix, "node_modules", name)
const output = execFileSync(process.execPath, [path.join(installed, "bin/apexo"), "--version"], {
  encoding: "utf8",
  timeout: 60_000,
}).trim()
if (output !== manifest.version) throw new Error(`Expected ${manifest.version}, received ${output}`)
console.log(`Installed ${name}@${output} from packed npm artifacts on ${platform}/${process.arch}`)
