# Inttegro Simile configuration

This directory is the public, runnable test composition for the Inttegro Commerce contract. The
OpenAPI document remains the authority for every route and payload. These HCL modules add only
observable integration behavior that OpenAPI cannot express by itself.

## Modules

- `inttegro.simile.hcl` composes the listener, OpenAPI contract, and behavior modules.
- `principals.hcl` declares the application caller and active, revoked, and expired test profiles.
- `behaviors.hcl` selects reviewed named OpenAPI outcomes through opaque scenarios.
- `errors.hcl` supplies exact, operation-valid domain failures and scenarios.
- `state.hcl` declares emulator-owned state, scheduled work, and source-backed async effects.
- `faults.hcl` provides opt-in latency and lost-response testing plus reproducible profiles.

Register and run the service from the OpenAPI repository root:

```bash
simile register inttegro --config ./simile/inttegro.simile.hcl
simile setup inttegro --profile checkout --set name="Checkout development"
simile start inttegro
```

Setup writes the generated application identifier and bearer credential to the profile environment
file reported by the command. The checked-in fixture credentials are `simile_test_active`,
`simile_test_revoked`, and `simile_test_expired`; they exercise the three public authentication
lifecycle states without setup.

Select deterministic public behavior when a test needs one exact result:

```bash
simile start inttegro --scenario order_payment_method_invalid
simile start inttegro --scenario refund_cannot_cancel
simile start inttegro --scenario upload_request_expired
simile start inttegro --scenario order_response_lost_after_commit
```

Use a bounded, seeded fault profile for retry and timeout suites:

```bash
simile start inttegro --fault-profile rough_idempotent_writes
```

Discover the complete current catalog and inspect committed test state without printing values:

```bash
simile describe service inttegro --verbose
simile state inttegro
```

Pass `--values` to `simile state` only in a controlled local or CI environment. Stored values are
synthetic public response snapshots, but they can include generated test credentials and customer
data supplied by the test.

## Publication boundary

The modules use public operation IDs, response fields, error tuples, lifecycle outcomes, and
portable Simile capabilities.

State effects make consequences inspectable; they do not yet make custom POST lookups read those
stored snapshots. Registered services checkpoint state, profiles, and deferred work locally.
Multipart decoding is supported by Simile, while multipart request-to-response projection remains
an explicit contract limitation. The fidelity gate also keeps schema-synthesized outcomes and
POST operations without an effect in reviewed inventories; it does not hide those gaps by
inventing outcomes or private state. See `../SIMILE_SERVICE_AUDIT.md` for the evidence and
validation record.
