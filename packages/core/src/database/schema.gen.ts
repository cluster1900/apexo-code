import { Effect } from "effect"
import type { DatabaseMigration } from "./migration"

export default {
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`background_job\` (
          \`id\` text PRIMARY KEY,
          \`type\` text NOT NULL,
          \`title\` text,
          \`status\` text NOT NULL,
          \`started_at\` integer NOT NULL,
          \`completed_at\` integer,
          \`output\` text,
          \`error\` text,
          \`metadata\` text,
          \`owner_id\` text NOT NULL,
          \`owner_generation\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`workspace\` (
          \`id\` text PRIMARY KEY,
          \`type\` text NOT NULL,
          \`name\` text DEFAULT '' NOT NULL,
          \`branch\` text,
          \`directory\` text,
          \`extra\` text,
          \`project_id\` text NOT NULL,
          \`time_used\` integer NOT NULL,
          CONSTRAINT \`fk_workspace_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`data_migration\` (
          \`name\` text PRIMARY KEY,
          \`time_completed\` integer NOT NULL
        );
      `)
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
      yield* tx.run(`
        CREATE TABLE \`session_execution\` (
          \`session_id\` text PRIMARY KEY,
          \`owner_id\` text NOT NULL,
          \`generation\` integer NOT NULL,
          \`status\` text NOT NULL,
          \`attempt_id\` text NOT NULL,
          \`started_at\` integer NOT NULL,
          \`heartbeat_at\` integer NOT NULL,
          \`ended_at\` integer,
          \`error\` text,
          CONSTRAINT \`fk_session_execution_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_hook_stop\` (
          \`engine\` text NOT NULL,
          \`message_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`state\` text NOT NULL,
          \`reason\` text,
          \`force_stop\` integer DEFAULT false NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`session_hook_stop_pk\` PRIMARY KEY(\`engine\`, \`message_id\`),
          CONSTRAINT \`fk_session_hook_stop_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_managed_child\` (
          \`session_id\` text PRIMARY KEY,
          \`parent_id\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_managed_child_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_managed_child_parent_id_session_id_fk\` FOREIGN KEY (\`parent_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_memory_operation\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`token\` text NOT NULL,
          \`created_event_id\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_memory_operation_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_plan_receipt\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`assistant_message_id\` text NOT NULL,
          \`call_id\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_plan_receipt_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_process\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`invocation\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_process_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_schedule_occurrence\` (
          \`id\` text PRIMARY KEY,
          \`schedule_id\` text NOT NULL,
          \`ordinal\` integer NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_schedule_occurrence_schedule_id_session_schedule_id_fk\` FOREIGN KEY (\`schedule_id\`) REFERENCES \`session_schedule\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_schedule\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`invocation\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_schedule_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_task_launch\` (
          \`id\` text PRIMARY KEY,
          \`admission_open\` integer DEFAULT false NOT NULL,
          \`admission_closed\` integer DEFAULT false NOT NULL,
          \`session_id\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_task_launch_session_id_session_task_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_task\`(\`session_id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_task_message\` (
          \`input_id\` text PRIMARY KEY,
          \`launch_id\` text NOT NULL,
          \`parent_created\` text NOT NULL,
          \`child_created\` text NOT NULL,
          \`delivery\` text NOT NULL,
          \`bytes\` integer NOT NULL,
          \`terminal\` text,
          \`promoted_at\` integer,
          CONSTRAINT \`fk_session_task_message_input_id_session_input_id_fk\` FOREIGN KEY (\`input_id\`) REFERENCES \`session_input\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_task_message_launch_id_session_task_launch_id_fk\` FOREIGN KEY (\`launch_id\`) REFERENCES \`session_task_launch\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_task\` (
          \`session_id\` text PRIMARY KEY,
          \`parent_id\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_task_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_task_parent_id_session_id_fk\` FOREIGN KEY (\`parent_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`account_state\` (
          \`id\` integer PRIMARY KEY,
          \`active_account_id\` text,
          \`active_org_id\` text,
          CONSTRAINT \`fk_account_state_active_account_id_account_id_fk\` FOREIGN KEY (\`active_account_id\`) REFERENCES \`account\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`account\` (
          \`id\` text PRIMARY KEY,
          \`email\` text NOT NULL,
          \`url\` text NOT NULL,
          \`access_token\` text NOT NULL,
          \`refresh_token\` text NOT NULL,
          \`token_expiry\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`control_account\` (
          \`email\` text NOT NULL,
          \`url\` text NOT NULL,
          \`access_token\` text NOT NULL,
          \`refresh_token\` text NOT NULL,
          \`token_expiry\` integer,
          \`active\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`control_account_pk\` PRIMARY KEY(\`email\`, \`url\`)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`credential\` (
          \`id\` text PRIMARY KEY,
          \`integration_id\` text,
          \`label\` text NOT NULL,
          \`value\` text NOT NULL,
          \`connector_id\` text,
          \`method_id\` text,
          \`active\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`event_sequence\` (
          \`aggregate_id\` text PRIMARY KEY,
          \`seq\` integer NOT NULL,
          \`owner_id\` text
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`event\` (
          \`id\` text PRIMARY KEY,
          \`aggregate_id\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`type\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_event_aggregate_id_event_sequence_aggregate_id_fk\` FOREIGN KEY (\`aggregate_id\`) REFERENCES \`event_sequence\`(\`aggregate_id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_feedback_draft\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_feedback_draft_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_feedback_image\` (
          \`id\` text PRIMARY KEY,
          \`draft_id\` text NOT NULL,
          \`mime_type\` text NOT NULL,
          \`file_name\` text NOT NULL,
          \`size\` integer NOT NULL,
          \`data\` blob NOT NULL,
          CONSTRAINT \`fk_session_feedback_image_draft_id_session_feedback_draft_id_fk\` FOREIGN KEY (\`draft_id\`) REFERENCES \`session_feedback_draft\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_goal_attempt\` (
          \`id\` text PRIMARY KEY,
          \`goal_id\` text NOT NULL,
          \`generation\` integer NOT NULL,
          \`kind\` text NOT NULL,
          \`state\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_finished\` integer,
          CONSTRAINT \`fk_session_goal_attempt_goal_id_session_goal_id_fk\` FOREIGN KEY (\`goal_id\`) REFERENCES \`session_goal\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_goal_cleanup\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`goal_id\` text NOT NULL,
          \`reason\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_goal\` (
          \`session_id\` text PRIMARY KEY,
          \`id\` text NOT NULL UNIQUE,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_goal_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_goal_usage\` (
          \`attempt_id\` text NOT NULL,
          \`id\` text NOT NULL,
          \`tokens\` integer NOT NULL,
          CONSTRAINT \`session_goal_usage_pk\` PRIMARY KEY(\`attempt_id\`, \`id\`),
          CONSTRAINT \`fk_session_goal_usage_attempt_id_session_goal_attempt_id_fk\` FOREIGN KEY (\`attempt_id\`) REFERENCES \`session_goal_attempt\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`permission\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`action\` text NOT NULL,
          \`resource\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_permission_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`project_directory\` (
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`type\` text,
          \`strategy\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`project_directory_pk\` PRIMARY KEY(\`project_id\`, \`directory\`),
          CONSTRAINT \`fk_project_directory_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`project\` (
          \`id\` text PRIMARY KEY,
          \`worktree\` text NOT NULL,
          \`vcs\` text,
          \`name\` text,
          \`icon_url\` text,
          \`icon_url_override\` text,
          \`icon_color\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_initialized\` integer,
          \`sandboxes\` text NOT NULL,
          \`commands\` text
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`message\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_message_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`part\` (
          \`id\` text PRIMARY KEY,
          \`message_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_part_message_id_message_id_fk\` FOREIGN KEY (\`message_id\`) REFERENCES \`message\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_context_epoch\` (
          \`session_id\` text PRIMARY KEY,
          \`baseline\` text NOT NULL,
          \`snapshot\` text NOT NULL,
          \`baseline_seq\` integer NOT NULL,
          CONSTRAINT \`fk_session_context_epoch_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_input\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`delivery\` text NOT NULL,
          \`execution_policy\` text,
          \`execution_status\` text,
          \`execution_owner\` text,
          \`execution_started_seq\` integer,
          \`execution_ended_seq\` integer,
          \`execution_reason\` text,
          \`execution_finish\` text,
          \`execution_usage_incomplete\` integer,
          \`admitted_seq\` integer NOT NULL,
          \`promoted_seq\` integer,
          \`withdrawn_seq\` integer,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_input_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_memory_backend\` (
          \`session_id\` text PRIMARY KEY,
          \`backend\` text NOT NULL,
          \`rollout\` text NOT NULL,
          \`skip_through\` text,
          CONSTRAINT \`fk_session_memory_backend_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_memory_context\` (
          \`session_id\` text NOT NULL,
          \`epoch\` text NOT NULL,
          \`content\` text NOT NULL,
          \`access_paths\` text NOT NULL,
          CONSTRAINT \`session_memory_context_pk\` PRIMARY KEY(\`session_id\`, \`epoch\`),
          CONSTRAINT \`fk_session_memory_context_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_memory_mode\` (
          \`session_id\` text PRIMARY KEY,
          \`enabled\` integer NOT NULL,
          \`revision\` text NOT NULL,
          CONSTRAINT \`fk_session_memory_mode_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_message\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_message_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`workspace_id\` text,
          \`parent_id\` text,
          \`slug\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`path\` text,
          \`title\` text NOT NULL,
          \`version\` text NOT NULL,
          \`share_url\` text,
          \`summary_additions\` integer,
          \`summary_deletions\` integer,
          \`summary_files\` integer,
          \`summary_diffs\` text,
          \`metadata\` text,
          \`cost\` real DEFAULT 0 NOT NULL,
          \`tokens_input\` integer DEFAULT 0 NOT NULL,
          \`tokens_output\` integer DEFAULT 0 NOT NULL,
          \`tokens_reasoning\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_write\` integer DEFAULT 0 NOT NULL,
          \`revert\` text,
          \`permission\` text,
          \`agent\` text,
          \`model\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_compacting\` integer,
          \`time_archived\` integer,
          CONSTRAINT \`fk_session_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`todo\` (
          \`session_id\` text NOT NULL,
          \`content\` text NOT NULL,
          \`status\` text NOT NULL,
          \`priority\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`todo_pk\` PRIMARY KEY(\`session_id\`, \`position\`),
          CONSTRAINT \`fk_todo_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_share\` (
          \`session_id\` text PRIMARY KEY,
          \`id\` text NOT NULL,
          \`secret\` text NOT NULL,
          \`url\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_share_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_side_question\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_side_question_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_workflow_run\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`revision\` integer NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_workflow_run_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`background_job_status_idx\` ON \`background_job\` (\`status\`,\`time_updated\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_execution_status_idx\` ON \`session_execution\` (\`status\`,\`heartbeat_at\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_hook_stop_pending_idx\` ON \`session_hook_stop\` (\`session_id\`,\`state\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_memory_operation_session_idx\` ON \`session_memory_operation\` (\`session_id\`,\`time_created\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_plan_receipt_session\` ON \`session_plan_receipt\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_plan_receipt_call\` ON \`session_plan_receipt\` (\`session_id\`,\`assistant_message_id\`,\`call_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_process_invocation_idx\` ON \`session_process\` (\`session_id\`,\`invocation\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_process_session_idx\` ON \`session_process\` (\`session_id\`,\`time_created\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_schedule_occurrence_ordinal_idx\` ON \`session_schedule_occurrence\` (\`schedule_id\`,\`ordinal\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_schedule_invocation_idx\` ON \`session_schedule\` (\`session_id\`,\`invocation\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_schedule_session_idx\` ON \`session_schedule\` (\`session_id\`,\`time_created\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_task_launch_session_idx\` ON \`session_task_launch\` (\`session_id\`,\`time_created\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_task_message_launch_idx\` ON \`session_task_message\` (\`launch_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_task_parent_idx\` ON \`session_task\` (\`parent_id\`,\`time_created\`);`)
      yield* tx.run(`CREATE UNIQUE INDEX \`event_aggregate_seq_idx\` ON \`event\` (\`aggregate_id\`,\`seq\`);`)
      yield* tx.run(`CREATE INDEX \`event_aggregate_type_seq_idx\` ON \`event\` (\`aggregate_id\`,\`type\`,\`seq\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_feedback_draft_session_idx\` ON \`session_feedback_draft\` (\`session_id\`,\`time_created\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_feedback_image_draft_idx\` ON \`session_feedback_image\` (\`draft_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_goal_attempt_goal_idx\` ON \`session_goal_attempt\` (\`goal_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_goal_cleanup_pending_idx\` ON \`session_goal_cleanup\` (\`time_updated\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`permission_project_action_resource_idx\` ON \`permission\` (\`project_id\`,\`action\`,\`resource\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`message_session_time_created_id_idx\` ON \`message\` (\`session_id\`,\`time_created\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`part_message_id_id_idx\` ON \`part\` (\`message_id\`,\`id\`);`)
      yield* tx.run(`CREATE INDEX \`part_session_idx\` ON \`part\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_input_session_pending_delivery_seq_idx\` ON \`session_input\` (\`session_id\`,\`promoted_seq\`,\`delivery\`,\`admitted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_input_session_admitted_seq_idx\` ON \`session_input\` (\`session_id\`,\`admitted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_input_session_promoted_seq_idx\` ON \`session_input\` (\`session_id\`,\`promoted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_message_session_seq_idx\` ON \`session_message\` (\`session_id\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_message_session_type_seq_idx\` ON \`session_message\` (\`session_id\`,\`type\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_message_session_time_created_id_idx\` ON \`session_message\` (\`session_id\`,\`time_created\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_message_time_created_idx\` ON \`session_message\` (\`time_created\`);`)
      yield* tx.run(`CREATE INDEX \`session_project_idx\` ON \`session\` (\`project_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_workspace_idx\` ON \`session\` (\`workspace_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_parent_idx\` ON \`session\` (\`parent_id\`);`)
      yield* tx.run(`CREATE INDEX \`todo_session_idx\` ON \`todo\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_side_question_session_idx\` ON \`session_side_question\` (\`session_id\`,\`time_created\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_workflow_run_session_idx\` ON \`session_workflow_run\` (\`session_id\`,\`time_created\`);`,
      )
    })
  },
} satisfies Omit<DatabaseMigration.Migration, "id">
