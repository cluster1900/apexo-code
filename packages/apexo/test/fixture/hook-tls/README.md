# Host hook TLS fixture

These certificates and the leaf private key are public test data, used only by loopback fixture servers. Never install this CA into a machine trust store or use this key for a real service. Tests opt into the CA through a scoped extra-bundle setting and retain normal certificate verification.

The leaf covers localhost, 127.0.0.1, and ::1. Both certificates expire in October 2036. The CA signing key is deliberately not retained. To replace the fixture, generate a test-only CA and RSA leaf with serverAuth and those subject alternative names, sign the leaf, and discard the CA private key and request intermediates.
