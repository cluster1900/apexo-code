import { expect } from "bun:test"
import { oauthServer } from "./mcp-oauth-server"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { McpOAuth } from "@apexo/core/mcp-oauth"
import { McpOAuthStore } from "@apexo/core/mcp-oauth-store"
import { AbsolutePath } from "@apexo/schema/schema"
export const setup = async (
  options: {
    disabled?: boolean
    busy?: boolean
    timeout?: number
    dcr?: boolean
    redirect?: string
    challenge?: boolean
  } = {},
) => {
  const root = await mkdtemp(path.join(tmpdir(), "apexo-oauth-flow-"))
  const http = oauthServer(options)
  const location = { directory: AbsolutePath.make(root) }
  const definition = {
    type: "remote" as const,
    url: `${http.server.url.origin}/mcp`,
    disabled: options.disabled,
    oauth: options.dcr ? {} : { client_id: "fixture-client", redirect_uri: options.redirect },
  }
  const manager = McpOAuth.make({
    location,
    data: root,
    definition: () => (http.state.retired ? undefined : definition),
    notify: () => {
      http.state.events++
    },
    publish: async (_, active) => {
      expect(active()).toBe(true)
      http.state.publish++
      return options.disabled ? "credentials_ready" : options.busy ? "retry_required" : "connected"
    },
    timeout: options.timeout,
  })
  const identity = McpOAuth.identity(location, "reference", definition)
  return {
    root,
    state: http.state,
    manager,
    definition,
    identity,
    store: McpOAuthStore.make(root),
    close: async () => {
      await manager.close()
      await http.server.stop(true)
      await rm(root, { recursive: true, force: true })
    },
  }
}
