import { createHash, createHmac, randomUUID } from "node:crypto"
import type { ConfigGrokMedia } from "@apexo/core/config/grok-media"

// Query authentication keeps storage credentials out of both model input and API headers.
export function presign(config: ConfigGrokMedia.OutputS3, date = new Date(), key = `${randomUUID()}.mp4`) {
  if (!config.bucket.trim() || !config.region.trim()) throw new Error("Video storage requires bucket and region")
  const endpoint = new URL(config.endpoint)
  if (
    endpoint.protocol !== "https:" &&
    !(endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))
  )
    throw new Error("Video storage endpoint must use HTTPS")
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new Error("Video storage endpoint must not contain credentials, query, or fragment")
  const timestamp = date.toISOString().replace(/[:-]|\.\d{3}/g, "")
  const day = timestamp.slice(0, 8)
  const scope = `${day}/${config.region}/s3/aws4_request`
  const pathname = [
    endpoint.pathname.replace(/\/$/, ""),
    encode(config.bucket),
    ...(config.key_prefix ?? "grok-videos").trim().split("/").filter(Boolean).map(encode),
    encode(key),
  ].join("/")
  const sign = (method: "GET" | "PUT", credentials: ConfigGrokMedia.OutputS3["read_write"]) => {
    if (!credentials.access_key_id.trim() || !credentials.secret_access_key.trim())
      throw new Error("Video storage requires access key ID and secret access key")
    const query = Object.entries({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${credentials.access_key_id}/${scope}`,
      "X-Amz-Date": timestamp,
      "X-Amz-Expires": String(Math.max(480, Math.min(604800, config.expires_secs ?? 900))),
      "X-Amz-SignedHeaders": "host",
    })
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `${encode(name)}=${encode(value)}`)
      .join("&")
    const canonical = `${method}\n${pathname}\n${query}\nhost:${endpoint.host}\n\nhost\nUNSIGNED-PAYLOAD`
    const signing = [day, config.region, "s3", "aws4_request"].reduce(
      (secret, value) => createHmac("sha256", secret).update(value).digest(),
      Buffer.from(`AWS4${credentials.secret_access_key}`),
    )
    const signature = createHmac("sha256", signing)
      .update(`AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${createHash("sha256").update(canonical).digest("hex")}`)
      .digest("hex")
    return `${endpoint.origin}${pathname}?${query}&X-Amz-Signature=${signature}`
  }
  return { upload: sign("PUT", config.read_write), download: sign(
      "GET",
      config.read_only?.access_key_id.trim() && config.read_only.secret_access_key.trim()
        ? config.read_only
        : config.read_write,
    ) }
}

function encode(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}
