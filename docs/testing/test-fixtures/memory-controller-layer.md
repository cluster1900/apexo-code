# BUG-20261015-221: Scoped controller fixture assumed a LayerNode has a layer field

- **Scope:** New real native Memory controller shutdown fixture; one fixture API assumption.
- **Observed:** The prior gate passed ten tests but failed the new scope-shutdown case; package typechecking also rejected access to `SessionMemoryOperation.node.layer`. The node exposes graph composition, not a public `.layer` field.
- **Expected:** A fresh scoped instance must run the canonical controller implementation with its real dependencies and joined finalizers.
- **Fix:** Export the canonical `Layer.effect(Service, make)` value, use that same value in the production node, and provide `Layer.fresh(SessionMemoryOperation.layer)` in the fixture. No implementation copy or mock controller was added.
- **Verification:** The corrected lifecycle gate passed twelve tests / 83 assertions and the private Apexo package typecheck passed. The real scoped-owner test holds extraction, observes a second controller's unverified receipt and refused foreign cancellation, closes the owner scope, then verifies durable cancellation and no exact-retry provider work.
