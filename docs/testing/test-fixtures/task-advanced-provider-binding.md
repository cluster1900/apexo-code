# BUG-20261015-282: Duplicate binding in the Task comparison provider

- Scope: new isolated installed-runtime Task advanced comparison fixture; no product code.
- Observed: `node --check` rejected the provider with `SyntaxError: Identifier 'raw' has already been declared`. No installed runtime child had launched.
- Expected: validate the actual fixture syntax before runtime setup.
- Cause: adapting the request-body parser added a second same-scope `raw` variable for selected user text. An earlier generation helper also selected an absent source substring and produced no script; that setup error is retained within this authoring work, not counted as another occurrence or product defect.
- Fix: name the selected user text explicitly and check the resulting actual script before launching it.
- Verification: the actual script passed `node --check`; the corrected isolated installed probe then passed three scenarios with eleven conversation and seventeen auxiliary requests, and all owned processes/listeners were reaped.
- Occurrences: one fixture-authoring episode. No recurring rule is proposed.
