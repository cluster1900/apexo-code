import { Effect, Option, Schema } from "effect"
import { sql } from "drizzle-orm"
import { SessionV1 } from "@apexo/schema/v1/session"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261014185747_native-command-sandbox",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_command_sandbox\` (
          \`session_id\` text PRIMARY KEY,
          \`created_event_id\` text NOT NULL,
          \`version\` integer NOT NULL,
          \`policy\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_command_sandbox_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      // Only the pre-migration population receives an explicit off baseline. Missing or
      // ambiguous durable creation evidence never becomes an implicit unconstrained policy.
      const rows = yield* tx.all<{ session_id: string; created_event_id: string; data: string }>(sql`
        SELECT session.id AS session_id, event.id AS created_event_id, event.data
        FROM session JOIN event ON event.aggregate_id = session.id
        WHERE event.type = 'session.created.1'
          AND (SELECT COUNT(*) FROM event AS proof
            WHERE proof.aggregate_id = session.id AND proof.type = 'session.created.1') = 1
      `)
      const decode = Schema.decodeUnknownOption(Schema.fromJsonString(SessionV1.Event.Created.data))
      for (const row of rows) {
        const event = decode(row.data)
        if (Option.isNone(event) || event.value.sessionID !== row.session_id || event.value.info.id !== row.session_id)
          continue
        yield* tx.run(sql`
          INSERT INTO session_command_sandbox (session_id, created_event_id, version, policy, time_created)
          VALUES (${row.session_id}, ${row.created_event_id}, 1,
            ${'{"policy":{"version":1,"scope":"native_commands","profile":"off","revision":"off-v1","network":"unrestricted"},"origin":"migration"}'},
            ${Date.now()})
        `)
      }
    })
  },
} satisfies DatabaseMigration.Migration
