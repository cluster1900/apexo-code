# BUG-20261014-087: Terminal side command omitted existing composer attachments

- Scope: new mini/fullscreen side-question command interception.
- Discovery: static audit; zero observed runtime failures before the fix.
- Observed in code: interception copied question text, then cleared the composer without transferring its existing image parts. Explicit image-file attachment inside the side panel already worked.
- Expected: existing inline image attachments accompany a typed side question.
- Reproduction: attach an image to the terminal composer, then submit `/btw` with a question.
- Root cause: the new panel accepted only initial question text; its image state always began empty.
- Fix: pass validated inline image bytes through the route/dialog into initial panel state. Reject unsupported or external file references before clearing the composer.
- Verification: fullscreen PTY passed nine checks, including an image attached in the main composer and transferred to the side provider. Apexo and TUI package typechecks passed. This is not counted as a recurring root cause.
