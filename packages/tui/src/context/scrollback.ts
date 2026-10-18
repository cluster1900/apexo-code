import { createSignal } from "solid-js"

// `/vim-mode` scrollback focus: while true the prompt stays blurred and vim keys drive the transcript.
export const [scrollback, setScrollback] = createSignal(false)
