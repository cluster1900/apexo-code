import { McpOAuthStore } from "@apexo/core/mcp-oauth-store"

const store = McpOAuthStore.make(process.argv[2]!)
await store.transaction(
  "shared-fixture",
  new AbortController().signal,
  () => true,
  async (snapshot, commit) => {
    await commit({
      issuer: "https://issuer.example",
      clientId: "fixture",
      accessToken: "fixture-access",
      refreshToken: crypto.randomUUID(),
    })
    process.stdout.write(JSON.stringify({ hadCredentials: !!snapshot.credentials }))
  },
)
