import { EOL } from "os"
import { cmd } from "./cmd"

function bashCompletionScript() {
  return [
    "###-begin-apexo-completions-###",
    "#",
    "# yargs command completion script",
    "#",
    "# Installation: apexo completion bash >> ~/.bashrc",
    "#    or apexo completion bash >> ~/.bash_profile on OSX.",
    "#",
    "_apexo_yargs_completions()",
    "{",
    "    local cur_word args type_list line",
    "",
    '    cur_word="${COMP_WORDS[COMP_CWORD]}"',
    '    args=("${COMP_WORDS[@]}")',
    "    type_list=()",
    "",
    "    # ask yargs to generate completions (compatible with macOS Bash 3.2+).",
    "    while IFS= read -r line; do",
    '      [ -n "$line" ] && type_list+=("$line")',
    '    done < <(SHELL=/bin/bash ZSH_NAME= apexo --get-yargs-completions "${args[@]}")',
    "",
    "    COMPREPLY=()",
    "    if [ ${#type_list[@]} -gt 0 ]; then",
    "      while IFS= read -r line; do",
    '        [ -n "$line" ] && COMPREPLY+=("$line")',
    '      done < <(compgen -W "$( printf \'%q \' "${type_list[@]}" )" -- "${cur_word}" |',
    '        awk \'/ / { print "\\""$0"\\"" } /^[^ ]+$/ { print $0 }\')',
    "    fi",
    "",
    "    return 0",
    "}",
    "complete -o bashdefault -o default -F _apexo_yargs_completions apexo",
    "###-end-apexo-completions-###",
    "",
  ].join(EOL)
}

function zshCompletionScript() {
  return [
    "#compdef apexo",
    "###-begin-apexo-completions-###",
    "#",
    "# yargs command completion script",
    "#",
    "# Installation: apexo completion zsh >> ~/.zshrc",
    "#    or apexo completion zsh >> ~/.zprofile on OSX.",
    "#",
    "_apexo_yargs_completions()",
    "{",
    "  local reply",
    "  local si=$IFS",
    '  IFS=$\'\\n\' reply=($(COMP_CWORD="$((CURRENT-1))" COMP_LINE="$BUFFER" COMP_POINT="$CURSOR" SHELL=/bin/zsh ZSH_NAME=zsh apexo --get-yargs-completions "${words[@]}"))',
    "  IFS=$si",
    "  if [[ ${#reply} -gt 0 ]]; then",
    "    _describe 'values' reply",
    "  else",
    "    _default",
    "  fi",
    "}",
    'if [[ "${zsh_eval_context[-1]}" == "loadautofunc" ]]; then',
    '  _apexo_yargs_completions "$@"',
    "else",
    "  if ! (( $+functions[compdef] )); then",
    '    autoload -Uz compinit && compinit -C -d "${TMPDIR:-/tmp}/.zcompdump-apexo-$$"',
    '    rm -f "${TMPDIR:-/tmp}/.zcompdump-apexo-$$"',
    "  fi",
    "  compdef _apexo_yargs_completions apexo",
    "fi",
    "###-end-apexo-completions-###",
    "",
  ].join(EOL)
}

export const CompletionCommand = cmd({
  command: "completion [shell]",
  describe: "generate shell completion script",
  builder: (yargs) =>
    yargs
      .positional("shell", {
        describe: "shell to generate completions for",
        type: "string",
        choices: ["bash", "zsh"] as const,
        default: "bash" as const,
      })
      .example("$0 completion bash >> ~/.bash_profile", "Install Bash completions on macOS")
      .example("$0 completion zsh >> ~/.zshrc", "Install Zsh completions on macOS"),
  handler: (args) => {
    const script = args.shell === "zsh" ? zshCompletionScript() : bashCompletionScript()
    process.stdout.write(script)
  },
})
