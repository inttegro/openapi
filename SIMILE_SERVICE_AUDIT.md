# Inttegro Simile service contract audit

## Resolved inputs

- Service and CLI name: `inttegro`
- OpenAPI authority: `commerce.yml` (OpenAPI 3.0.3, `0.1.0-beta78`)
- Service configuration: `inttegro.simile.hcl`
- Behavior overlay: `behaviors.hcl`
- Listener: `127.0.0.1:4242`
- Primary public workflows: application and key management; catalog, product, price, and Buy-link management; checkout, orders, payments, refunds, balances, payouts, and financial accounts; customers, Chimes, OTP, files, upload requests, and policy management.

## Evidence inspected

- The complete OpenAPI operation, component, example, response, and error inventory in `commerce.yml`.
- Public Upper request handlers and validators for financial-account creation/connection, mobile-money tokenization, and Purchase Intent creation.
- The checked-in Insomnia requests and generated Postman collections. `scripts/check-contract.mjs` proves one-to-one coverage and validates their request bodies against OpenAPI.
- The global and per-operation error evidence in `scripts/operation-error-codes.mjs`, `scripts/check-error-contract.mjs`, and `scripts/check-operation-error-contract.mjs`.
- The relationship evidence and fixtures in `SIMILE_SOUNDNESS.md` and `scripts/check-simile-soundness.mjs`.
- Simile 0.1.1 compiler, runtime, HCL, and HTTP-adapter behavior in the nested `simile` source and its checked-in debug binary.

Implementation evidence was used only to confirm public wire behavior. Storage layout, provider decisions, production thresholds, dependency names, and private state transitions were not published.

## Contract audit

The contract contains 135 stable, uniquely identified operations, 132 request bodies, 637 declared response outcomes, and 498 operation/status error mappings. Every operation has tags, request coverage in both client collections, declared success and error schemas, and a stable `operationId`. The complete per-operation table is in [SIMILE_OPERATION_COVERAGE.md](./SIMILE_OPERATION_COVERAGE.md).

This pass corrected three contract defects:

1. The three financial-account request variants and the mobile-money tokenization request used closed OpenAPI 3.0 `allOf` composition. Each closed base rejected the subtype's own public fields, so the schemas admitted no complete request. They are now closed, fully declared object variants with the same public fields and discriminator values.
2. Purchase Intent creation expressed its ten legal target/price combinations through nested `allOf`, `oneOf`, `anyOf`, and `not` branches whose required fields were declared only by the parent. The contract was valid for supplied callers but was not constructible by Simile. Each exact alternative now declares constructible field schemas while the parent continues to own the public shape and reject extra fields. Product targets require exactly one price representation; bundle targets accept either the catalog price or exactly one special-offer price representation.
3. Important outcomes had exact schemas but no named response examples. Three representative successes are now exact OpenAPI examples: a safely masked tokenized mobile-money method, a published product, and an active Buy link with a special-offer price. Seven source-proven errors are exact examples: Chime cooldown, invalid order payment method, refund currency mismatch, payout restriction, malformed payment-method tokenization, oversized product gallery, and an invalid Purchase Intent quantity range.

No public route, method, field name, status, content type, request/response envelope, or side effect was changed. The new HCL contains only ten opaque scenario selectors for those OpenAPI-owned examples. It defines no body, route, predicate, resource, dependency, or private decision rule.

## Soundness ownership

Ordinary OpenAPI continues to own field-local validation, closed objects, requiredness, discriminators, enum values, nullability, identifier patterns, request alternatives, and exact error tuple unions. Existing `x-simile-constraints` own the proven public cross-field invariants listed in `SIMILE_SOUNDNESS.md`: ordering, dynamic bounds, implications, equality, disjoint sets, equations, aggregates, lifecycle snapshots, and templates.

This pass added no speculative `x-simile-constraints`. The Purchase Intent quantity bound remains attached to the narrow quantity object, and every corrected request alternative is expressed with standard OpenAPI because its rule is structural rather than a new cross-field operator.

## Remaining gaps

- Two successful operations are transport-only: `openFileLink` returns a redirect and `streamFileContents` returns `application/octet-stream`. Simile's JSON `run` command cannot synthesize those bodies, although the compiled HTTP service registers both routes.
- Simile 0.1.1 does not compile OpenAPI `pattern`, so the specification and JavaScript tests prove 118 typed response-ID prefixes while Simile synthesis can still generate unprefixed strings. Tightening permissive request IDs would contradict the public parsers.
- A `$ref` inside an OpenAPI Example Object is valid OpenAPI but is not imported by Simile 0.1.1. The ten small examples are therefore inline at their response media types so their outcomes compile.
- Default protocol-error adaptation chooses an operation-declared status and schema-valid tuple, but it cannot infer which domain error caused an arbitrary invalid body. Exact causal errors are exposed as named outcomes and HTTP scenarios instead of publishing private decision logic.
- The connect handler accepts an untyped `pull_configuration.mandate` value, while the existing public contract documents only `enabled`. No normative public shape or safe synthesis contract was found for that value, so it remains deliberately unpublished rather than exposing an arbitrary implementation payload.
- The inexpressible relationships already catalogued in `SIMILE_SOUNDNESS.md` remain unresolved: heterogeneous order-total reconstruction, discriminator-crossing currency and aggregate rules, current-time-derived states, payout's private executing timestamp, filtered pagination state, pairwise uniqueness through referenced items, array-wildcard dynamic bounds, conditional disjunction, header/body equality, and error-URL lookup priority.
- The current runtime records declared async plans but does not execute abstract resources. No async declaration was added because this audit found no source-backed public promise that should be simulated as a plan.

## Validation report

The final validation commands are:

```bash
npm run lint:openapi
npm run test:simile-service
npm run postman:check
npm test
/Users/yaw/.cargo/bin/simile compile commerce.yml \
  --behavior behaviors.hcl \
  --artifact /tmp/inttegro.similec \
  --output json
/Users/yaw/.cargo/bin/simile inspect /tmp/inttegro.similec --output json
SIMILE_HOME="$(mktemp -d)" /Users/yaw/.cargo/bin/simile register inttegro \
  --config ./inttegro.simile.hcl \
  --output json
```

Results:

- Redocly: valid OpenAPI; two pre-existing unused-component warnings for the balance-transaction base schemas.
- Simile compile: success, OpenAPI 3.0.3, service version `0.1.0-beta78`, 135 operations, zero abstract resources, zero async operations.
- Artifact inspection: format 9, compiler 0.1.1, 135 operations, 132 request bodies, 637 outcomes, 625 schema-synthesized outcomes, ten OpenAPI-derived named outcomes, ten scenario selections, 126 operations without an exact named outcome, and `publicExportSafe: true`. Those operations remain schema-synthesized because the evidence did not justify inventing fixed payloads.
- Request/response synthesis: every one of the 133 JSON-capable operations synthesized and self-validated; the two transport-only operations are explicitly allow-listed.
- Supplied requests: all nine request examples declared directly in OpenAPI replayed successfully, along with bank-account owner-source alternatives, a Dosh marker, and bundle Buy links with catalog and special-offer prices; the complete Insomnia/Postman corpus remains validated by the contract test.
- Negative requests: missing financial-account subtype data, missing financial-account owner data, an unsupported mobile-money network, and a contradictory Purchase Intent target/quantity payload were rejected.
- Exact outcomes: all three named successes and seven named errors, plus all ten HCL scenario selections, returned the exact provider-authored payload shape and values.
- Local listener: isolated registration compiled the composition root at `127.0.0.1:4242`; `purchase_intent_created` returned the exact named 200 Buy-link payload and `purchase_intent_invalid_quantity_range` returned the exact named 400 error over HTTP.

The full `npm test` command also re-proves 118 typed-ID patterns, 327 global error tuples, all 498 operation/status error mappings, 228 cross-field relationships, 330 sound/unsound relationship fixtures, generated Postman parity, and the contract lock.
