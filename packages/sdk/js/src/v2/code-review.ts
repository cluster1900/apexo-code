import type { ApexoClient } from "./gen/sdk.gen.js"

/** Native feature availability is independent of the connection's selected Session transport. */
export async function codeReviewAvailable(client: ApexoClient, sessionID: string, signal?: AbortSignal) {
  const result = await client.v2.codeReview.list({ sessionID, limit: "1" }, { signal, throwOnError: false })
  if (result.response.status === 404 || result.response.status === 405) return false
  if (!result.response.ok) throw new Error(`Code review capability check failed (HTTP ${result.response.status})`)
  return !!result.data && Array.isArray(result.data.data)
}
