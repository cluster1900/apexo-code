import { expect, test } from "bun:test"
import { feedbackExport, feedbackImageDataUrl, feedbackImageSnapshot } from "../src/v2/feedback-images"
import type { FeedbackIssue } from "../src/v2/gen/types.gen"
const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC"
test("feedback export escapes report and attachment names and preserves original image bytes", async () => {
  const file = new File([Buffer.from(data, "base64")], 'quote"<img onerror=alert(1)>.png', { type: "image/png" })
  const snapshot = await feedbackImageSnapshot(file)
  expect(snapshot.data).toBe(data)
  const image = { id: "feedback_image_1", fileName: file.name, mimeType: "image/png" as const, size: file.size }
  const issue: FeedbackIssue = {
    title: "<script>alert(1)</script>",
    body: '<img src=x onerror="alert(1)"> & report',
    url: "https://github.com/example",
    draft: {
      id: "feedback_1",
      sessionID: "ses_1",
      title: "draft",
      details: "details",
      type: "bug",
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
      images: [image],
    },
  }
  const exported = feedbackExport(issue, [{ ...image, data }], { manual: "Manual upload", download: "Download image" })
  expect(exported.extension).toBe("html")
  expect(exported.content).not.toContain("<script>")
  expect(exported.content).not.toContain("<img src=x")
  expect(exported.content).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
  expect(exported.content).toContain("quote&quot;&lt;img onerror=alert(1)&gt;.png")
  expect(exported.content).toContain(`href="data:image/png;base64,${data}"`)
  expect(() => feedbackExport(issue, [], { manual: "", download: "" })).toThrow("feedback_image_revision")
  expect(() => feedbackExport(issue, [{ ...image, id: "other", data }], { manual: "", download: "" })).toThrow()
  expect(() => feedbackImageDataUrl({ data: '" onerror=alert(1)', mimeType: "image/png" })).toThrow()
  const plain = feedbackExport({ ...issue, draft: { ...issue.draft, images: [] } }, [], { manual: "", download: "" })
  expect(plain.content).toBe(`# ${issue.title}\n\n${issue.body}`)
  expect(plain.extension).toBe("md")
})
test("feedback file selection rejects unsupported MIME, empty and oversized payloads", async () => {
  await expect(feedbackImageSnapshot(new Blob([]))).rejects.toThrow()
  await expect(feedbackImageSnapshot(new Blob([Buffer.alloc(8 * 1024 * 1024 + 1)]))).rejects.toThrow()
  await expect(feedbackImageSnapshot(new Blob(["<svg></svg>"], { type: "image/svg+xml" }))).rejects.toThrow()
  await expect(feedbackImageSnapshot(new Blob([Buffer.from(data, "base64")], { type: "image/jpeg" }))).rejects.toThrow()
})
