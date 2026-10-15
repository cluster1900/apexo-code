import type { McpAttachmentResult } from "@apexo/sdk/v2/mcp-attachment"
import type { Prompt } from "@/context/prompt"

export function appendMcpAttachments(prompt: Prompt, prepared: NonNullable<McpAttachmentResult["prepared"]>): Prompt {
  const start = prompt.reduce((end, part) => (part.type === "image" ? end : Math.max(end, part.end)), 0)
  const additions = prepared.files.reduce<{ parts: Prompt; end: number }>(
    (result, file) => {
      const content = `@${file.name}`
      const offset = result.end + 1
      return {
        end: offset + content.length,
        parts: [
          ...result.parts,
          { type: "text", content: " ", start: result.end, end: offset },
          {
            type: "file",
            path: prepared.resourceURI,
            content,
            start: offset,
            end: offset + content.length,
            filename: file.name,
            mime: file.mimeType,
            url: file.uri,
          },
        ],
      }
    },
    { parts: [], end: start },
  )
  return [...prompt, ...additions.parts]
}
