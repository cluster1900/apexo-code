import type { FilePart } from "@apexo/sdk/v2"

const tools = new Set(["image_gen", "image_edit", "image_to_video", "reference_to_video"])

// Native structured output is not part of the vendored facade's older metadata type.
export function mediaMetadata(name: string, value: unknown): { path: string; mime: string } | undefined {
  if (!tools.has(name) || !value || typeof value !== "object") return
  const structured: unknown = Reflect.get(value, "structured") ?? Reflect.get(value, "metadata")
  if (!structured || typeof structured !== "object") return
  const path: unknown = Reflect.get(structured, "path")
  const mime: unknown = Reflect.get(structured, "mime")
  if (typeof path !== "string" || typeof mime !== "string") return
  if (!["image/png", "image/jpeg", "image/webp", "video/mp4"].includes(mime)) return
  return { path, mime }
}

export function mediaVideoAttachment(input: {
  name: string
  state: unknown
  id: string
  sessionID: string
  messageID: string
}): FilePart | undefined {
  if (input.name !== "image_to_video" && input.name !== "reference_to_video") return
  const media = mediaMetadata(input.name, input.state)
  if (!media || media.mime !== "video/mp4" || !/^(\/|[A-Za-z]:[\\/])/.test(media.path)) return
  const url = new URL("file:///")
  url.pathname = media.path.replaceAll("\\", "/")
  return {
    type: "file",
    id: `${input.id}:saved-video`,
    sessionID: input.sessionID,
    messageID: input.messageID,
    filename: media.path.replaceAll("\\", "/").split("/").at(-1),
    mime: media.mime,
    url: url.href,
  }
}
