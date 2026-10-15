export * as SessionProcessOutput from "./process-output"

import type { AppProcess } from "../process"

/** Bounded text preview; each channel owns its incremental UTF-8 decoder. */
export function make(limit: number) {
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder(), combined: new TextDecoder() }
  const state = { output: "", bytes: 0, truncated: false, finished: false }
  const append = (text: string) => {
    if (!text || state.truncated) return false
    const bytes = Buffer.from(text)
    const remaining = limit - state.bytes
    if (bytes.length <= remaining) {
      state.output += text
      state.bytes += bytes.length
      return true
    }
    // Streaming decode deliberately withholds a code point split by the byte limit.
    const prefix = new TextDecoder().decode(bytes.subarray(0, Math.max(0, remaining)), { stream: true })
    state.output += prefix
    state.bytes += Buffer.byteLength(prefix)
    state.truncated = true
    return true
  }
  return {
    push: (chunk: AppProcess.OutputChunk) => {
      if (state.finished || state.truncated) return false
      return append(decoders[chunk.channel].decode(chunk.data, { stream: true }))
    },
    finish: () => {
      if (state.finished) return
      for (const decoder of Object.values(decoders)) append(decoder.decode())
      state.finished = true
    },
    read: () => ({ output: state.output, truncated: state.truncated }),
  }
}
