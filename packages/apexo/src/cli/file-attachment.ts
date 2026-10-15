import { constants } from "node:fs"
import { open } from "node:fs/promises"
import path from "node:path"
import { FSUtil } from "@apexo/core/fs-util"

/** Snapshot an explicitly supplied local file using the existing upload convention. */
export async function readRunAttachment(filename: string) {
  // Nonblocking open allows the descriptor check to reject FIFOs without waiting for a writer.
  const handle = await open(filename, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || Number(stat.size) > 10 * 1024 * 1024)
      throw new Error(`Cannot attach local file larger than 10 MiB or a special file: ${filename}`)
    const buffer = Buffer.alloc(Number(stat.size))
    let offset = 0
    while (offset < buffer.length) {
      const read = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }
    const content = buffer.subarray(0, offset)
    const text = content.toString("utf8")
    const mime = Buffer.from(text, "utf8").equals(content) ? "text/plain" : FSUtil.mimeType(filename)
    return {
      type: "file" as const,
      url: `data:${mime};base64,${content.toString("base64")}`,
      filename: path.basename(filename),
      mime,
    }
  } finally {
    await handle.close()
  }
}
