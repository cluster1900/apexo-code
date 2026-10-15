import path from "node:path"
import { chmod, copyFile, mkdir } from "node:fs/promises"

type Target = { os: string; arch: string; abi?: string }
const artifacts = new Map<string, Promise<string>>()

export async function stageWorkflowInterpreter(directory: string, target: Target) {
  const arch = target.arch === "arm64" ? "aarch64" : target.arch === "x64" ? "x86_64" : undefined
  const platform =
    target.os === "darwin"
      ? "apple-darwin"
      : target.os === "win32"
        ? "pc-windows-msvc"
        : target.os === "linux"
          ? `unknown-linux-${target.abi === "musl" ? "musl" : "gnu"}`
          : undefined
  if (!arch || !platform) throw new Error(`Unsupported workflow interpreter target: ${target.os}/${target.arch}`)
  const triple = `${arch}-${platform}`
  const filename = `apexo-workflow-script${target.os === "win32" ? ".exe" : ""}`
  if (!artifacts.has(triple)) artifacts.set(triple, build(triple, filename))
  const source = await artifacts.get(triple)!
  await mkdir(directory, { recursive: true })
  const destination = path.join(directory, filename)
  await copyFile(source, destination)
  if (target.os !== "win32") await chmod(destination, 0o755)
  return destination
}

async function build(triple: string, filename: string) {
  // Release jobs may supply target-native artifacts; never substitute the build host's executable.
  if (process.env.APEXO_WORKFLOW_ARTIFACTS) {
    const supplied = path.join(process.env.APEXO_WORKFLOW_ARTIFACTS, triple, filename)
    if (!(await Bun.file(supplied).exists())) throw new Error(`Missing workflow interpreter artifact: ${supplied}`)
    return supplied
  }
  const root = path.resolve(import.meta.dirname, "..")
  const child = Bun.spawn(["cargo", "build", "--release", "--locked", "--target", triple], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await child.exited) !== 0)
    throw new Error(
      `Cannot build the workflow interpreter for ${triple}. Install its Rust target and linker, or set APEXO_WORKFLOW_ARTIFACTS to target-native artifacts.`,
    )
  return path.join(root, "target", triple, "release", filename)
}
