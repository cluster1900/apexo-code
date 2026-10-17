export * as MediaS3 from "./media-s3"

import { createHash, createHmac } from "node:crypto"
import { ConfigMedia } from "../config/media"

// SigV4 query authentication, adapted from Apexo's existing compatibility signer.
// Preparation is pure validation; sign only after the exact upload resource is authorized.
export function prepare(config: ConfigMedia.Storage, filename: string) {
  if (!config.bucket.trim() || !config.region.trim() || /[\x00-\x20\x7f/]/.test(config.bucket + config.region))
    throw new Error("Video storage requires a valid bucket and region")
  const endpoint = new URL(config.endpoint)
  if (
    endpoint.protocol !== "https:" &&
    !(endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))
  )
    throw new Error("Video storage endpoint must use HTTPS")
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new Error("Video storage endpoint must not contain credentials, query or fragment")
  const prefix = (config.key_prefix ?? "grok-videos").trim().replace(/^\/+|\/+$/g, "")
  if (
    prefix.length > 512 ||
    /[\x00-\x1f\x7f]/.test(prefix) ||
    prefix.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error("Invalid video storage key prefix")
  if (!/^[A-Za-z0-9-]+\.mp4$/.test(filename)) throw new Error("Invalid video storage filename")
  const key = prefix ? `${prefix}/${filename}` : filename
  const pathname = `${endpoint.pathname.replace(/\/$/, "")}/${encode(config.bucket)}/${key.split("/").map(encode).join("/")}`
  return {
    config,
    url: new URL(endpoint.origin + pathname),
    resource: `s3://${encode(config.bucket)}/${key.split("/").map(encode).join("/")}`,
  }
}

function signCapability(
  input: ReturnType<typeof prepare>,
  date: Date,
  method: "GET" | "PUT",
  credentials: ConfigMedia.Storage["read_write"],
) {
  const timestamp = date.toISOString().replace(/[:-]|\.\d{3}/g, "")
  const day = timestamp.slice(0, 8)
  const scope = `${day}/${input.config.region}/s3/aws4_request`
  const headers = method === "PUT" ? "content-type;host" : "host"
  const canonicalHeaders =
    method === "PUT" ? `content-type:video/mp4\nhost:${input.url.host}\n` : `host:${input.url.host}\n`
  const query = Object.entries({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${credentials.access_key_id}/${scope}`,
    "X-Amz-Date": timestamp,
    "X-Amz-Expires": String(input.config.expires_secs ?? 900),
    "X-Amz-SignedHeaders": headers,
  })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${encode(name)}=${encode(value)}`)
    .join("&")
  const canonical = `${method}\n${input.url.pathname}\n${query}\n${canonicalHeaders}\n${headers}\nUNSIGNED-PAYLOAD`
  const signing = [day, input.config.region, "s3", "aws4_request"].reduce(
    (secret, value) => createHmac("sha256", secret).update(value).digest(),
    Buffer.from(`AWS4${credentials.secret_access_key}`),
  )
  const signature = createHmac("sha256", signing)
    .update(`AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${createHash("sha256").update(canonical).digest("hex")}`)
    .digest("hex")
  return `${input.url.origin}${input.url.pathname}?${query}&X-Amz-Signature=${signature}`
}

export function signUpload(input: ReturnType<typeof prepare>, date: Date) {
  return signCapability(input, date, "PUT", input.config.read_write)
}

export function signDownload(input: ReturnType<typeof prepare>, date: Date) {
  return signCapability(input, date, "GET", input.config.read_only ?? input.config.read_write)
}

export function sign(input: ReturnType<typeof prepare>, date: Date) {
  return {
    upload: signUpload(input, date),
    download: signDownload(input, date),
  }
}

function encode(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

