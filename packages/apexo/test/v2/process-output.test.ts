import { expect, test } from "bun:test"
import { SessionProcessOutput } from "@apexo/core/session/process-output"

test("process capture retains split UTF-8 without replacement and separates pending channel bytes", () => {
  const capture = SessionProcessOutput.make(64)
  const bytes = Buffer.from("😀")
  capture.push({ channel: "stdout", data: bytes.subarray(0, 2) })
  capture.push({ channel: "stderr", data: Buffer.from("ERR") })
  capture.push({ channel: "stdout", data: bytes.subarray(2) })
  capture.finish()
  expect(capture.read()).toEqual({ output: "ERR😀", truncated: false })
  capture.push({ channel: "stdout", data: Buffer.from("LATE") })
  expect(capture.read().output).toBe("ERR😀")
})

test("capture never cuts a multibyte character at its bound and drops later output once truncated", () => {
  const capture = SessionProcessOutput.make(5)
  capture.push({ channel: "combined", data: Buffer.from("abc😀tail") })
  expect(capture.read()).toEqual({ output: "abc", truncated: true })
  for (let index = 0; index < 1000; index++) capture.push({ channel: "combined", data: Buffer.alloc(1024, 65) })
  capture.finish()
  expect(capture.read()).toEqual({ output: "abc", truncated: true })
  expect(Buffer.byteLength(capture.read().output)).toBeLessThanOrEqual(5)
})

test("exact-size output remains complete and zero-byte bounds accurately report loss", () => {
  const exact = SessionProcessOutput.make(4)
  for (const byte of Buffer.from("😀")) exact.push({ channel: "stdout", data: Uint8Array.of(byte) })
  exact.finish()
  expect(exact.read()).toEqual({ output: "😀", truncated: false })
  const empty = SessionProcessOutput.make(0)
  empty.push({ channel: "stderr", data: Buffer.from("a") })
  empty.finish()
  expect(empty.read()).toEqual({ output: "", truncated: true })
})
