# BUG-20261014-081: Server handler imported an undeclared Schema dependency

- Scope: native SideQuestion HTTP handler; one observed full-typecheck failure.
- Observed: the Server package could not resolve `@apexo/schema/session-id`.
- Expected: the handler respects Server's declared dependency graph.
- Reproduction: run package typechecking after registering the native SideQuestion handler.
- Root cause: the new handler directly imported Schema although Server declares the shared type through Core.
- Fix: use the existing exported `SessionSchema.ID` from Core.
- Verification: Server and Core package typechecks pass; native V2 HTTP/provider test passes 1 test and 13 assertions.
