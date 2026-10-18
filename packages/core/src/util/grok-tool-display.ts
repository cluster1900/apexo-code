/**
 * Grok Build tool names and inputs (exposed to xAI models) mapped to the Apexo tool views that render them.
 * Shared by the CLI TUI and the Desktop timeline so both show a Grok tool call the same way.
 */
const aliases: Record<string, string> = {
  run_terminal_command: "bash",
  run_terminal_cmd: "bash",
  read_file: "read",
  list_dir: "list",
  search_replace: "edit",
  spawn_subagent: "task",
  enter_plan_mode: "plan_enter",
  exit_plan_mode: "plan_exit",
  todo_write: "todowrite",
  ask_user_question: "question",
  web_fetch: "webfetch",
}

export function canonicalToolName(name: string) {
  return aliases[name] ?? name
}

export function canonicalToolInput(name: string, input: Record<string, any>): Record<string, any> {
  if (name === "run_terminal_command" || name === "run_terminal_cmd")
    return { ...input, timeout: input.timeout ?? input.block_until_ms }
  if (name === "read_file") return { ...input, filePath: input.filePath ?? input.target_file }
  if (name === "list_dir") return { ...input, path: input.path ?? input.target_directory }
  if (name === "search_replace")
    return {
      ...input,
      filePath: input.filePath ?? input.file_path,
      oldString: input.oldString ?? input.old_string,
      newString: input.newString ?? input.new_string,
      replaceAll: input.replaceAll ?? input.replace_all,
    }
  return input
}
