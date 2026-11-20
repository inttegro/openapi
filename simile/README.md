# Inttegro Simile configuration

This directory is the public, runnable test composition for the Inttegro Commerce contract. The
OpenAPI document remains the authority for every route and payload. These HCL modules add only
observable integration behavior that OpenAPI cannot express by itself.

## Modules

- `inttegro.simile.hcl` composes the listener, OpenAPI contract, and behavior modules.
- `behaviors.hcl` selects reviewed named OpenAPI outcomes through opaque scenarios.
- `errors.hcl` supplies exact, operation-valid domain failures and scenarios.
- `state.hcl` declares emulator-owned state, scheduled work, and source-backed async effects.
- `faults.hcl` provides opt-in latency and lost-response testing plus reproducible profiles.

Register and run the service from the OpenAPI repository root:

```bash
simile register inttegro --config ./simile/inttegro.simile.hcl
simile start inttegro
```

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

State effects make consequences inspectable; they do not yet make later lookups read those stored
snapshots. Async declarations prove what work a successful operation dispatches, not durable
production delivery. Authentication, multipart decoding, and network webhook delivery remain
explicit simulator boundaries. See `../SIMILE_SERVICE_AUDIT.md` for the evidence and validation
record.
