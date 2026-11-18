# Inttegro Simile service contract audit

## Resolved inputs

- Service and CLI name: `inttegro`
- OpenAPI authority: `commerce.yml` (OpenAPI 3.0.3, `0.1.0-beta81`)
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
- Simile 0.2.0 compiler, runtime, HCL, and HTTP-adapter behavior from the published CLI.

Implementation evidence was used only to confirm public wire behavior. Storage layout, provider decisions, production thresholds, dependency names, and private state transitions were not published.

## Contract audit

The contract contains 135 stable, uniquely identified operations, 132 request bodies, 637 declared response outcomes, and 498 operation/status error mappings. Every operation has tags, request coverage in both client collections, declared success and error schemas, and a stable `operationId`. The complete per-operation table is in [SIMILE_OPERATION_COVERAGE.md](./SIMILE_OPERATION_COVERAGE.md).

This pass corrected six contract defects:

1. The three financial-account request variants and the mobile-money tokenization request used closed OpenAPI 3.0 `allOf` composition. Each closed base rejected the subtype's own public fields, so the schemas admitted no complete request. They are now closed, fully declared object variants with the same public fields and discriminator values.
2. Purchase Intent creation expressed its ten legal target/price combinations through nested `allOf`, `oneOf`, `anyOf`, and `not` branches whose required fields were declared only by the parent. The contract was valid for supplied callers but was not constructible by Simile. Each exact alternative now declares constructible field schemas while the parent continues to own the public shape and reject extra fields. Product targets require exactly one price representation; bundle targets accept either the catalog price or exactly one special-offer price representation.
3. Important outcomes had exact schemas but no named response examples. Three representative successes are now exact OpenAPI examples: a safely masked tokenized mobile-money method, a published product, and an active Buy link with a special-offer price. Seven source-proven errors are exact examples: Chime cooldown, invalid order payment method, refund currency mismatch, payout restriction, malformed payment-method tokenization, oversized product gallery, and an invalid Purchase Intent quantity range.
4. Schema-valid success synthesis was independent of the submitted request. Constructive `x-simile-from-request` relations now cover 111 operations, preserving selectors, mutable values, pagination, sort choices, state changes, and policy-version arithmetic. The remaining 24 operations are exact, reviewed exceptions rather than silently unrelated successes.
5. The generic search response could advertise financial-account search while returning product, order, payout, or customer projections. Five operation-specific response schemas now fix the advertised type, per-type totals, and result references; the shared sort object preserves the caller's concrete `field` and `direction` while enforcing relevance-descending semantics.
6. Mobile-money tokenization reused a generic payment-method response and could synthesize another rail. Its response is now narrowed to the existing `mobile_money` shape while retaining the masked-number template and four-decimal-digit `last4` rule.

No public route, method, field name, status, content type, request/response envelope, or side effect was changed. The HCL contains nine opaque scenario selectors for request-independent OpenAPI-owned examples. The product-created success remains a named OpenAPI example but is intentionally not an unconditional scenario because its `active` state depends on the request's `publish` value. HCL defines no body, route, resource, dependency, or private decision rule.

## Soundness ownership

Ordinary OpenAPI continues to own field-local validation, closed objects, requiredness, discriminators, enum values, nullability, identifier patterns, request alternatives, and exact error tuple unions. Existing `x-simile-constraints` own the proven public cross-field invariants listed in `SIMILE_SOUNDNESS.md`: ordering, dynamic bounds, implications, equality, disjoint sets, equations, aggregates, lifecycle snapshots, and templates. Response-media `x-simile-from-request` blocks own the separately provable relationship between a submitted request and its successful response.

This pass added no speculative relationships. Purchase Intent target/variant coherence, chronological expiry, and search-sort direction are attached to the narrowest owning objects. Operation-specific resource discriminators remain ordinary OpenAPI enums.

## Remaining gaps

- Two successful operations are transport-only: `openFileLink` returns a redirect and `streamFileContents` returns `application/octet-stream`. Simile's JSON `run` command cannot synthesize those bodies, although the compiled HTTP service registers both routes.
- The 24 request-to-response exceptions remain explicit: authentication-scoped/static empty-request reads, multipart or transport bodies, payout and delivery lifecycle envelopes, the Purchase Intent target union, mobile-number masking, and conditional page normalization. They are schema-sound but are not claimed as request-reachable.
- A `$ref` inside an OpenAPI Example Object is valid OpenAPI but is not imported as an exact outcome. The small provider-authored examples are therefore inline at their response media types so their outcomes compile.
- Default protocol-error adaptation chooses an operation-declared status and schema-valid tuple, but it cannot infer which domain error caused an arbitrary invalid body. Exact causal errors are exposed as named outcomes and HTTP scenarios instead of publishing private decision logic.
- The connect handler accepts an untyped `pull_configuration.mandate` value, while the existing public contract documents only `enabled`. No normative public shape or safe synthesis contract was found for that value, so it remains deliberately unpublished rather than exposing an arbitrary implementation payload.
- The inexpressible relationships already catalogued in `SIMILE_SOUNDNESS.md` remain unresolved: heterogeneous order-total reconstruction, discriminator-crossing currency and aggregate rules, current-time-derived states, payout's private executing timestamp, filtered pagination state, pairwise uniqueness through referenced items, array-wildcard dynamic bounds, conditional disjunction, header/body equality, and error-URL lookup priority.
- The current runtime records declared async plans but does not execute abstract resources. No async declaration was added because this audit found no source-backed public promise that should be simulated as a plan.

## Validation report

The final validation commands are:

```bash
npm run lint:openapi
npm run test:simile-service
npm run test:request-response-relations
npm run postman:check
npm test
simile compile commerce.yml \
  --behavior behaviors.hcl \
  --artifact /tmp/inttegro.similec \
  --output json
simile inspect /tmp/inttegro.similec --output json
SIMILE_HOME="$(mktemp -d)" simile register inttegro \
  --config ./inttegro.simile.hcl \
  --output json
```

Results:

- Redocly: valid OpenAPI; five unused-component warnings. Two are the pre-existing balance-transaction bases; three retain the formerly shared search components so existing component consumers are not broken while operations use stricter route-specific schemas.
- Simile compile: success with compiler 0.2.0, OpenAPI 3.0.3, service version `0.1.0-beta81`, 135 operations, zero abstract resources, and zero async operations.
- Artifact inspection: format 11, 135 operations, 132 request bodies, 637 responses, 640 outcomes, 624 schema-synthesized outcomes, nine scenario selections, 126 operations without an exact named outcome, and `publicExportSafe: true`.
- Request/response synthesis: 129 JSON operations synthesized without input, three bounded policy-version operations used valid finite request seeds, one Purchase Intent page finite-search gap is documented, and the two transport-only operations are explicitly allow-listed.
- Request reachability: 111 operations carry 111 constructive success-payload relations; the remaining 24 operations match the exact reviewed exception inventory. All 111 relation maps are also preserved in both Smithy outputs.
- Supplied requests: all request examples declared directly in OpenAPI replayed successfully, along with bank-account owner-source alternatives, a Dosh marker, bundle Buy links with catalog and special-offer prices, and a complete operating-policy capability snapshot; 16 valid supplied requests ran in total.
- Negative requests: missing financial-account subtype data, missing financial-account owner data, an unsupported mobile-money network, and a contradictory Purchase Intent target/quantity payload were rejected.
- Exact outcomes: all nine unconditional HCL scenario selections returned the expected provider-authored payload shape and values. The request-dependent product success is verified through its relation rather than an unconditional scenario.
- Local listener: isolated registration compiled the composition root at `127.0.0.1:4242`; `purchase_intent_created` returned the exact named 200 Buy-link payload and `purchase_intent_invalid_quantity_range` returned the exact named 400 error over HTTP.

The full contract gate also re-proves 118 typed-ID patterns, 327 global error tuples, all 498 operation/status error mappings, 181 allow-listed cross-field relationships with 362 sound/unsound fixture payloads, generated Postman parity, deterministic OpenAPI/Smithy artifacts, and the contract lock.
