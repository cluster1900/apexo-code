import type { FeedbackImageContent, FeedbackImageSnapshot, FeedbackIssue } from "./gen/types.gen.js"

export async function feedbackImageSnapshot(file: Blob & { readonly name?: string }): Promise<FeedbackImageSnapshot> {
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error("feedback_image_size")
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mimeType =
    bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
      ? "image/png"
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? "image/jpeg"
        : String.fromCharCode(...bytes.subarray(0, 6)) === "GIF87a" ||
            String.fromCharCode(...bytes.subarray(0, 6)) === "GIF89a"
          ? "image/gif"
          : undefined
  if (!mimeType || (file.type && file.type !== mimeType)) throw new Error("feedback_image_format")
  const chunks = Array.from({ length: Math.ceil(bytes.length / 32768) }, (_, index) =>
    String.fromCharCode(...bytes.subarray(index * 32768, (index + 1) * 32768)),
  )
  return { data: btoa(chunks.join("")), mimeType, ...(file.name ? { fileName: file.name } : {}) }
}

export function feedbackImageDataUrl(image: Pick<FeedbackImageContent, "data" | "mimeType">) {
  if (!["image/png", "image/jpeg", "image/gif"].includes(image.mimeType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data))
    throw new Error("feedback_image_format")
  return `data:${image.mimeType};base64,${image.data}`
}

export function feedbackExport(
  issue: FeedbackIssue,
  images: readonly FeedbackImageContent[],
  labels: { readonly manual: string; readonly download: string },
) {
  const expected = issue.draft.images ?? []
  if (
    expected.length !== images.length ||
    expected.some((item, index) => {
      const image = images[index]
      return (
        !image ||
        image.id !== item.id ||
        image.fileName !== item.fileName ||
        image.mimeType !== item.mimeType ||
        image.size !== item.size ||
        atob(image.data).length !== item.size
      )
    })
  )
    throw new Error("feedback_image_revision")
  if (!images.length)
    return { content: `# ${issue.title}\n\n${issue.body}`, mime: "text/markdown;charset=utf-8", extension: "md" }
  const escaped = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;")
  return {
    content: `<!doctype html><html><head><meta charset="utf-8"><title>${escaped(issue.title)}</title><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>body{max-width:64rem;margin:2rem auto;padding:0 1rem;font-family:system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere}img{max-width:100%;max-height:32rem}figure{margin:2rem 0}</style></head><body><h1>${escaped(issue.title)}</h1><pre>${escaped(issue.body)}</pre><p>${escaped(labels.manual)}</p>${images.map((image) => `<figure><img alt="${escaped(image.fileName)}" src="${feedbackImageDataUrl(image)}"><figcaption>${escaped(image.fileName)} · <a download="${escaped(image.fileName)}" href="${feedbackImageDataUrl(image)}">${escaped(labels.download)}</a></figcaption></figure>`).join("")}</body></html>`,
    mime: "text/html;charset=utf-8",
    extension: "html",
  }
}
