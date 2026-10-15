import { MemoryOperation } from "@apexo/schema/memory-operation"
import { SessionID } from "@apexo/schema/session-id"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError } from "../errors"
import { MemoryForbiddenError } from "./memory"

export class MemoryOperationNotFoundError extends Schema.TaggedErrorClass<MemoryOperationNotFoundError>()(
  "MemoryOperationNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}
const root = "/api/session/:sessionID/memory"
const session = { sessionID: SessionID }
const target = { ...session, operationID: MemoryOperation.ID }
const error = [
  MemoryOperationNotFoundError,
  SessionNotFoundError,
  MemoryForbiddenError,
  ConflictError,
  InvalidRequestError,
  ServiceUnavailableError,
]
export const MemoryOperationGroup = HttpApiGroup.make("server.memoryOperation").add(
  HttpApiEndpoint.post("memory.retry", `${root}/retry`, {
    params: session,
    payload: MemoryOperation.RetryInput,
    success: MemoryOperation.Info,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.memory.retry",
      summary: "Explicitly retry an owned Memory receipt using its original private request",
    }),
  ),
  HttpApiEndpoint.get("memory.recoveryPreview", `${root}/recovery`, {
    params: session,
    query: MemoryOperation.RecoveryQuery,
    success: MemoryOperation.RecoveryPreview,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.memory.recoveryPreview",
      summary: "Inspect explicit Memory discard or clear without recovery or provider work",
    }),
  ),
  HttpApiEndpoint.post("memory.recover", `${root}/recovery`, {
    params: session,
    payload: MemoryOperation.RecoveryInput,
    success: MemoryOperation.Info,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.memory.recover",
      summary: "Admit a permissioned generation-bound Memory discard or clear",
    }),
  ),
  HttpApiEndpoint.get("memory.migrationPreview", `${root}/migration`, {
    params: session,
    query: MemoryOperation.MigrationQuery,
    success: MemoryOperation.MigrationPreview,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.memory.migrationPreview",
      summary: "Preview fixed-scope Memory migration without publication or provider work",
    }),
  ),
  HttpApiEndpoint.post("memory.migrate", `${root}/migration`, {
    params: session,
    payload: MemoryOperation.MigrationInput,
    success: MemoryOperation.Info,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.memory.migrate",
      summary: "Admit an explicit source-hash and generation-bound Memory migration",
    }),
  ),
  HttpApiEndpoint.post("memory.dream", `${root}/dream`, {
    params: session,
    payload: MemoryOperation.Input,
    success: MemoryOperation.Info,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.memory.dream",
      summary: "Admit an explicit Dream operation; exact retry never relaunches inference",
    }),
  ),
  HttpApiEndpoint.post("memory.flush", `${root}/flush`, {
    params: session,
    payload: MemoryOperation.Input,
    success: MemoryOperation.Info,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.memory.flush",
      summary: "Admit an explicit bounded Memory flush; exact operation retry never relaunches work",
    }),
  ),
  HttpApiEndpoint.get("memory.operations", `${root}/operation`, {
    params: session,
    success: Schema.Array(MemoryOperation.Info),
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.memory.operations",
      summary: "Read the newest 100 Memory operation receipts without starting or recovering work",
    }),
  ),
  HttpApiEndpoint.get("memory.operation", `${root}/operation/:operationID`, {
    params: target,
    success: MemoryOperation.Info,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.memory.operation",
      summary: "Read a Session-owned Memory operation receipt",
    }),
  ),
  HttpApiEndpoint.post("memory.cancel", `${root}/operation/:operationID/cancel`, {
    params: target,
    success: MemoryOperation.Info,
    error,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.memory.cancel",
      summary: "Cancel and join a local Memory worker; bodyless and never guesses a remote owner dead",
    }),
  ),
)
