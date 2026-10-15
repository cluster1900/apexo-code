import { createServer } from "node:http"
import { connect } from "node:net"
import { setTimeout } from "node:timers/promises"

// Compare the exact Node HTTP adapter events used for request cancellation.
const events = []
const server = createServer(async (request, response) => {
  request.socket.once("close", () => events.push("socket.close"))
  response.once("close", () => events.push("response.close"))
  request.once("aborted", () => events.push("request.aborted"))
  for await (const chunk of request) void chunk
  events.push("body.read")
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
if (!address || typeof address === "string") throw new Error("TCP address unavailable")
const socket = connect(address.port, "127.0.0.1")
socket.on("error", () => {})
socket.write("POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
const deadline = Date.now() + 3000
while (!events.includes("body.read") && Date.now() < deadline) await setTimeout(10)
if (!events.includes("body.read")) throw new Error("Server did not consume request")
socket.destroy()
await setTimeout(500)
console.log(
  JSON.stringify({
    runtime: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`,
    events: [...events],
  }),
)
server.closeAllConnections()
await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
