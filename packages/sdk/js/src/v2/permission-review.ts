/** Presentation-only view of backend-owned review state carried by compatibility adapters. */
export function permissionReviewStatus(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.nativeReview
  if (!value || typeof value !== "object" || !("status" in value)) return
  if (value.status !== "reviewing" && value.status !== "ask_manual") return
  return {
    status: value.status,
    reason: "reason" in value && typeof value.reason === "string" ? value.reason : undefined,
  }
}
