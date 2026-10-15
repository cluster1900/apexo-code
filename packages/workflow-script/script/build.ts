import path from "node:path"
const target = process.argv.find((value) => value.startsWith("--target="))?.slice(9)
const root = path.resolve(import.meta.dir, "..")
const child = Bun.spawn(["cargo", "build", "--release", "--locked", ...(target ? ["--target", target] : [])], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
})
if ((await child.exited) !== 0) throw new Error("Workflow script interpreter compilation failed")
console.log(
  path.join(
    root,
    "target",
    ...(target ? [target] : []),
    "release",
    `apexo-workflow-script${(target ? target.includes("windows") : process.platform === "win32") ? ".exe" : ""}`,
  ),
)
