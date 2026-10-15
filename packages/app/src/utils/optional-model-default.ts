/** Older native clients request a default endpoint absent from current native servers. */
export function optionalModelDefault<T>(request: Promise<T>): Promise<T | undefined> {
  return request.catch((error: unknown) => {
    if (
      error instanceof Error &&
      error.cause &&
      typeof error.cause === "object" &&
      "status" in error.cause &&
      error.cause.status === 404
    )
      return undefined
    throw error
  })
}
