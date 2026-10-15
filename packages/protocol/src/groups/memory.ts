import { NativeMemory } from "@apexo/schema/memory-native"
import { MemoryMode } from "@apexo/schema/memory-mode"
import { MemoryNote } from "@apexo/schema/memory-note"
import { SessionID } from "@apexo/schema/session-id"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError } from "../errors"

export class MemoryForbiddenError extends Schema.TaggedErrorClass<MemoryForbiddenError>()(
  "MemoryForbiddenError",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}
const root = "/api/session/:sessionID/memory"
const params = { sessionID: SessionID }
const error = [MemoryForbiddenError, SessionNotFoundError, ConflictError, InvalidRequestError, ServiceUnavailableError]
export const MemoryGroup = HttpApiGroup.make("server.memory").add(
  HttpApiEndpoint.get("memory.status", root, { params, success: NativeMemory.Info, error }).annotateMerge(
    OpenApi.annotations({ identifier: "v2.memory.status", summary: "Read passive Memory mode status" }),
  ),
  HttpApiEndpoint.patch("memory.toggle", root, {
    params,
    payload: MemoryMode.Update,
    success: NativeMemory.Info,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.memory.toggle",
      summary: "Enable or disable Memory without starting background work",
    }),
  ),
  HttpApiEndpoint.get("memory.list", `${root}/notes`, {
    params,
    query: { query: Schema.optional(Schema.String) },
    success: Schema.Array(MemoryNote.Summary),
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.memory.list",
      summary: "List authorized saved notes without migration or model work",
    }),
  ),
  HttpApiEndpoint.get("memory.preview", `${root}/note`, {
    params,
    query: { path: Schema.String },
    success: MemoryNote.Detail,
    error,
  }).annotateMerge(
    OpenApi.annotations({ identifier: "v2.memory.preview", summary: "Preview an authorized saved note" }),
  ),
  HttpApiEndpoint.delete("memory.forget", `${root}/note`, {
    params,
    payload: MemoryNote.Forget,
    success: Schema.Boolean,
    error,
  }).annotateMerge(
    OpenApi.annotations({ identifier: "v2.memory.forget", summary: "Forget the exact reviewed note hash" }),
  ),
)
