import fs from "fs"
import * as tty from "node:tty"

export const INTERACTIVE_INPUT_ERROR = "--mini requires a controlling terminal for input"

type InteractiveStdin = {
  stdin: NodeJS.ReadStream
  cleanup?: () => void
}

function openTerminalStdin(path: string): NodeJS.ReadStream {
  return new tty.ReadStream(fs.openSync(path, "r"))
}

export function resolveInteractiveStdin(
  stdin: NodeJS.ReadStream = process.stdin,
  open: (path: string) => NodeJS.ReadStream = openTerminalStdin,
  platform = process.platform,
): InteractiveStdin {
  if (stdin.isTTY) {
    return { stdin }
  }

  const file = platform === "win32" ? "CONIN$" : "/dev/tty"

  try {
    const stream = open(file)
    return {
      stdin: stream,
      cleanup: () => {
        stream.destroy()
      },
    }
  } catch (error) {
    throw new Error(INTERACTIVE_INPUT_ERROR, { cause: error })
  }
}

export async function readPipedStdin(hasPositionalInput = false): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined
  if (!hasPositionalInput) return Bun.stdin.text()
  return new Promise<string | undefined>((resolve) => {
    const chunks: Buffer[] = []
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      process.stdin.removeListener("data", onData)
      process.stdin.removeListener("end", finish)
      process.stdin.removeListener("error", finish)
      process.stdin.pause()
      process.stdin.unref?.()
      resolve(chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : undefined)
    }
    const onData = (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
      clearTimeout(timer)
      timer = setTimeout(finish, 50)
      timer.unref?.()
    }
    let timer = setTimeout(finish, 50)
    timer.unref?.()
    process.stdin.on("data", onData)
    process.stdin.once("end", finish)
    process.stdin.once("error", finish)
    process.stdin.resume()
  })
}

