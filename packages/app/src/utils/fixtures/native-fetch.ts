import { fetch } from "bun"

export const nativeFetch: typeof globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    signal?.throwIfAborted()
    const request = (async () => {
      if (input instanceof Request) {
        const method = init?.method ?? input.method
        const headers = Object.fromEntries(new Headers(init?.headers ?? input.headers).entries())
        const body =
          init?.body !== undefined
            ? init.body
            : method !== "GET" && method !== "HEAD"
              ? (await input.text()) || undefined
              : undefined
        return fetch(input.url, { method, headers, body })
      }
      const headers = init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : undefined
      return fetch(String(input), { ...init, headers, signal: undefined })
    })()
    if (!signal) return request
    return Promise.race([
      request,
      new Promise<never>((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")), {
          once: true,
        }),
      ),
    ])
  },
  { preconnect: fetch.preconnect },
)
