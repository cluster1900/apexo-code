import path from "node:path"

// Public test-only key and CA. Never install this CA into a machine trust store.
export function hookTLS() {
  const previous = process.env.GROK_EXTRA_CA_BUNDLE
  process.env.GROK_EXTRA_CA_BUNDLE = path.join(import.meta.dir, "hook-tls/ca.pem")
  return {
    tls: {
      key: Bun.file(path.join(import.meta.dir, "hook-tls/key.pem")),
      cert: Bun.file(path.join(import.meta.dir, "hook-tls/cert.pem")),
    },
    [Symbol.dispose]() {
      if (previous === undefined) delete process.env.GROK_EXTRA_CA_BUNDLE
      else process.env.GROK_EXTRA_CA_BUNDLE = previous
    },
  }
}
