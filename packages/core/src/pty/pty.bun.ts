import { Terminal } from "bun-pty"
import type { Exit, Opts, Proc } from "./pty"

export type { Disp, Exit, Opts, Proc } from "./pty"

export function spawn(file: string, args: string[], opts: Opts): Proc {
  // Bun 1.3's native terminal is POSIX-only; retain ConPTY on Windows.
  if (process.platform === "win32") return new Terminal(file, args, opts)
  const data = new Set<(chunk: string) => void>()
  const exits = new Set<(event: Exit) => void>()
  const state: { output: string; exit?: Exit } = { output: "" }
  const decoder = new TextDecoder()
  const emit = (chunk: string) => {
    if (!data.size) state.output = (state.output + chunk).slice(-2 * 1024 * 1024)
    for (const listener of data) listener(chunk)
  }
  // Register callbacks as part of spawn. The old bun-pty polling constructor
  // could emit an immediate exit before onExit was registered. Bun also owns
  // child reaping, so a second native waitpid watcher must not race it.
  const proc = Bun.spawn([file, ...args], {
    cwd: opts.cwd,
    env: opts.env,
    terminal: {
      name: opts.name,
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      data: (_, chunk) => emit(decoder.decode(chunk, { stream: true })),
    },
  })
  const terminal = proc.terminal!
  void proc.exited.then((exitCode) => {
    emit(decoder.decode())
    state.exit = { exitCode, ...(proc.signalCode ? { signal: proc.signalCode } : {}) }
    for (const listener of exits) listener(state.exit)
    exits.clear()
    terminal.close()
  })
  return {
    pid: proc.pid,
    onData(listener) {
      data.add(listener)
      if (state.output) {
        listener(state.output)
        state.output = ""
      }
      return {
        dispose: () => {
          data.delete(listener)
        },
      }
    },
    onExit(listener) {
      if (state.exit) listener(state.exit)
      if (!state.exit) exits.add(listener)
      return {
        dispose: () => {
          exits.delete(listener)
        },
      }
    },
    write: (chunk) => {
      if (!state.exit) terminal.write(chunk)
    },
    resize: (cols, rows) => {
      if (!state.exit) terminal.resize(cols, rows)
    },
    kill: (signal) => {
      if (!state.exit) proc.kill(signal as NodeJS.Signals | undefined)
    },
  }
}
