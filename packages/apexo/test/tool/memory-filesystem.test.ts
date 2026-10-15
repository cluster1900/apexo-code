import { expect, test } from "bun:test"
import { MemoryFilesystem } from "@apexo/core/memory-filesystem"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { tmpdir } from "../fixture/fixture"

test("Linux Memory filesystem policy rejects remote and FUSE magic values, including signed words", () => {
  for (const type of [
    0x6969n,
    0x517bn,
    0xfe534d42n,
    0xff534d42n,
    0x01021997n,
    0x73757245n,
    0x5346414fn,
    0x6b414653n,
    0x00c36400n,
    0x0bd00bd0n,
    0x01161970n,
    0x47504653n,
    0x7461636fn,
    0x18031977n,
    0x65735546n,
  ]) {
    expect(MemoryFilesystem.linuxNetwork(type)).toBe(true)
    expect(MemoryFilesystem.linuxNetwork(BigInt.asIntN(32, type))).toBe(true)
  }
  for (const type of [0xef53n, 0x58465342n, 0x9123683en, 0x01021994n, 0x794c7630n, 0n])
    expect(MemoryFilesystem.linuxNetwork(type)).toBe(false)
})

test("macOS Memory filesystem policy selects the containing mount and checks local flags and FUSE names", () => {
  const mounts = [
    "/dev/disk1 on / (apfs, local, journaled)",
    "host:/Users on /Users/network (nfs, nodev)",
    "/dev/disk2 on /Users/network/local (apfs, local)",
    "host on /source on /Volumes/Team on Share (work) (smbfs, local, mounted by example)",
    "unknown on /Volumes/Future (futurefs)",
    "bridge on /Volumes/FUSE (MacFUSE, local)",
    "host:/archive on /Volumes/With\nNewline (nfs)",
    "",
  ].join("\n")
  expect(MemoryFilesystem.macNetwork(mounts, "/Users/network/home/new-directory")).toBe(true)
  expect(MemoryFilesystem.macNetwork(mounts, "/Users/network/local/home")).toBe(false)
  expect(MemoryFilesystem.macNetwork(mounts, "/Users/network-similar/home")).toBe(false)
  expect(MemoryFilesystem.macNetwork(mounts, "/Volumes/Team on Share (work)/home")).toBe(true)
  expect(MemoryFilesystem.macNetwork(mounts, "/Volumes/Future/home")).toBe(true)
  expect(MemoryFilesystem.macNetwork(mounts, "/Volumes/FUSE/home")).toBe(true)
  expect(MemoryFilesystem.macNetwork(mounts, "/Volumes/With\nNewline/home")).toBe(true)
  expect(MemoryFilesystem.macNetwork(mounts, "/private/tmp/home")).toBe(false)
  expect(MemoryFilesystem.macNetwork("unreadable output", "/home")).toBeUndefined()
})

test("Windows Memory filesystem policy distinguishes UNC from verbatim local and device paths", () => {
  for (const directory of [
    "\\\\server\\share\\home",
    "\\\\?\\UNC\\server\\share",
    "\\\\?\\unc\\server\\share",
    "//server/share",
  ])
    expect(MemoryFilesystem.windowsUNC(directory)).toBe(true)
  for (const directory of ["C:\\Users\\name", "Z:\\home", "\\\\?\\C:\\Users", "\\\\.\\C:\\Users", "/tmp/home"])
    expect(MemoryFilesystem.windowsUNC(directory)).toBe(false)
})

test("actual filesystem probing supports absent descendants without creating them", async () => {
  await using home = await tmpdir()
  const target = MemoryV2.directory({ home: home.path, directory: home.path })
  expect(await MemoryFilesystem.network(target)).toBe(false)
  expect(await Bun.file(`${target}/memory_state.sqlite`).exists()).toBe(false)
  expect(await Bun.file(`${target}/MEMORY.md`).exists()).toBe(false)
})
