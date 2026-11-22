# Inttegro Simile service contract audit

## Resolved inputs

- Service and CLI name: `inttegro`
- OpenAPI authority: `commerce.yml` (OpenAPI 3.0.3, `0.1.0-beta97`)
- Service configuration: `simile/inttegro.simile.hcl`
- Behavior overlays: `simile/principals.hcl`, `simile/behaviors.hcl`, `simile/errors.hcl`, `simile/state.hcl`, and `simile/faults.hcl`
- Listener: `127.0.0.1:4242`
- Primary public workflows: application and key management; catalog, product, price, and Buy-link management; checkout, orders, payments, refunds, balances, payouts, and financial accounts; customers, Chimes, OTP, files, upload requests, and policy management.

## Evidence inspected

- The complete OpenAPI operation, component, example, response, and error inventory in `commerce.yml`.
- Public Upper request handlers and validators for financial-account creation/connection, mobile-money tokenization, and Purchase Intent creation.
- The checked-in Insomnia requests and generated Postman collections. `scripts/check-contract.mjs` proves one-to-one coverage and validates their request bodies against OpenAPI.
- The global and per-operation error evidence in `scripts/operation-error-codes.mjs`, `scripts/check-error-contract.mjs`, and `scripts/check-operation-error-contract.mjs`.
- The relationship evidence and fixtures in `SIMILE_SOUNDNESS.md` and `scripts/check-simile-soundness.mjs`.
- Public operation descriptions and Upper tests for resource mutation, scheduled Chimes and payouts, asynchronous broadcasts and refunds, and file cleanup.
- Simile 0.3.0 compiler, runtime, HCL, and HTTP-adapter behavior from the current workspace source.

Implementation evidence was used to confirm public wire behavior.

## Contract audit

The contract contains 135 stable, uniquely identified operations, 132 request bodies, 637 declared response outcomes, and 498 operation/status error mappings. Every operation has tags, request coverage in both client collections, declared success and error schemas, and a stable `operationId`. The complete per-operation table is in [SIMILE_OPERATION_COVERAGE.md](./SIMILE_OPERATION_COVERAGE.md).

This pass corrected six contract defects:

1. The three financial-account request variants and the mobile-money tokenization request used closed OpenAPI 3.0 `allOf` composition. Each closed base rejected the subtype's own public fields, so the schemas admitted no complete request. They are now closed, fully declared object variants with the same public fields and discriminator values.
2. Purchase Intent creation expressed its ten legal target/price combinations through nested `allOf`, `oneOf`, `anyOf`, and `not` branches whose required fields were declared only by the parent. The contract was valid for supplied callers but was not constructible by Simile. Each exact alternative now declares constructible field schemas while the parent continues to own the public shape and reject extra fields. Product targets require exactly one price representation; bundle targets accept either the catalog price or exactly one special-offer price representation.
3. Important outcomes had exact schemas but no named response examples. Three representative successes are now exact OpenAPI examples: a safely masked tokenized mobile-money method, a published product, and an active Buy link with a special-offer price. Seven source-proven errors are exact examples: Chime cooldown, invalid order payment method, refund currency mismatch, payout restriction, malformed payment-method tokenization, oversized product gallery, and an invalid Purchase Intent quantity range.
4. Schema-valid success synthesis was independent of the submitted request. Constructive `x-simile-from-request` relations now cover 122 operations and 124 successful payloads, preserving selectors, mutable values, pagination, sort choices, state changes, policy-version arithmetic, order document identity, payout identity, Purchase Intent targets and settings, and the stable parts of tokenized payment-method identity. The remaining 13 operations are exact, reviewed exceptions rather than silently unrelated successes.
5. The generic search response could advertise financial-account search while returning product, order, payout, or customer projections. Five operation-specific response schemas now fix the advertised type, per-type totals, and result references; the shared sort object preserves the caller's concrete `field` and `direction` while enforcing relevance-descending semantics.
6. Mobile-money tokenization reused a generic payment-method response and could synthesize another rail. Its response is now narrowed to the existing `mobile_money` shape while retaining the masked-number template and four-decimal-digit `last4` rule.

This follow-up corrected six further response-fidelity defects:

1. Product shipment synthesis could mix delivery, download, render, service, and stream markers. The response is now an exact closed union, empty response-only custom data and invoice settings are excluded, and request/response projection no longer invents optional shipment or custom-data fields.
2. Invoice and receipt delivery could return the wrong document kind, an incompatible order lifecycle state, or empty/overlapping channel results. Operation-specific refinements, distinct/disjoint channel constraints, and complete and partial named outcomes now enforce the public delivery semantics.
3. Payout schedule and cancellation could synthesize lifecycle-incompatible snapshots. Their success responses now require the operation's status and timestamp evidence without making the legitimately optional selected amount required.
4. Buy-link create, update, lookup, cancel, and page responses now use an exact product-or-bundle target union, operation-specific lifecycle states, realistic named outcomes, and bounded page fields.
5. Secret-key pages now prove their count against both the returned size and total while preserving the public page-size limit.
6. Operating-policy updates now expose a reviewed activated-version outcome whose `version` and `active_version` both prove the same `expected_version + 1` arithmetic together with the selected policy ID.

The hardening pass also binds tokenization responses to the submitted customer, payment-method type, and mobile-money network. The response schema independently proves that the displayed account number is masked and agrees with `last4`.

No public route, method, field name, status, content type, or request/response envelope was changed. Redirect responses now declare their existing `Location` header contract explicitly. The expanded HCL publishes 37 deterministic scenario selections: 17 select reviewed OpenAPI examples, 19 select provider-authored domain outcomes whose status and tuple are already part of the operation contract, and one selects the bodyless file-link redirect. File-content redirect selection is controlled by the public `delivery` request field. Five additional scenarios inject opt-in transport faults without changing the selected domain result.

The local setup declares the public application caller, three synthetic credential-lifecycle profiles, and one application-setup workflow. Setup creates a local application identity through `createApplication`, stores its generated bearer credential as sensitive profile data, and withholds that credential from command output. The fixture profiles provide deterministic active, revoked, and expired authentication states.

The service also declares three portable Simile backends: one logical public-state namespace, one queue, and one scheduler. Twenty-nine explicitly authored effects record public resource snapshots or schedule only source-backed consequences. Three asynchronous units represent the operations documented as continuing after acceptance: Chime broadcast processing, refund processing, and file cleanup. Inttegro uses POST for reads, so the test gate requires zero convention-inferred effects; this prevents lookup operations from becoming false writes. Simile's conservative POST `/lookup` and `/page` read convention now returns the snapshots those authored effects commit.

## Soundness ownership

Ordinary OpenAPI continues to own field-local validation, closed objects, requiredness, discriminators, enum values, nullability, identifier patterns, request alternatives, and exact error tuple unions. Existing `x-simile-constraints` own the proven public cross-field invariants listed in `SIMILE_SOUNDNESS.md`: ordering, dynamic bounds, implications, equality, disjoint sets, equations, aggregates, lifecycle snapshots, and templates. Response-media `x-simile-from-request` blocks own the separately provable relationship between a submitted request and its successful response.

This pass added no speculative payload relationships. Purchase Intent target/variant coherence, chronological expiry, and search-sort direction remain attached to the narrowest owning objects. Operation-specific resource discriminators remain ordinary OpenAPI enums. HCL effects project only public request or response fields and cannot weaken those schemas.

## Remaining gaps

- Two operations include transport-only successes: `openFileLink` can return bytes or a redirect, and `streamFileContents` can return bytes or a redirect. Their bodyless redirect headers and non-empty binary responses are exercised through Simile's HTTP adapter rather than represented as JSON payloads.
- Durable effects now make ordinary single-resource POST `/lookup` and POST `/page` operations read the snapshots committed by successful mutations. Composite selectors, filtered pages, searches, and multi-resource projections remain outside the conservative state convention and are still schema-synthesized unless an exact outcome covers them.
- Deferred work is committed to Simile's durable local outbox and uses leased retries and dead-letter storage. The service library exposes dead-letter inspection and redelivery, while a dedicated operator CLI remains unavailable.
- Bearer authentication now exercises active, revoked, expired, missing, and setup-generated credentials. Multipart decoding is supported; request-to-response projection for multipart bodies remains unavailable, so the two multipart success relations stay explicit exceptions.
- No public callback or webhook contract is currently declared. The configuration does not invent event names, payloads, or delivery destinations to approximate one.
- The 13 request-to-response exceptions remain explicit: authentication-scoped or static empty-request reads, multipart or transport bodies, and conditional secret-key page normalization. They are schema-sound but are not claimed as request-reachable.
- Tokenization now preserves the submitted customer, payment-method type, and network. Deriving `last4` from the request remains deliberately unexpressed because public account-number parsing normalizes formatting before storage while the relation language has no digit-normalization transform; approximating it with a raw substring would reject accepted formatted input.
- A `$ref` inside an OpenAPI Example Object is valid OpenAPI but is not imported as an exact outcome. The small provider-authored examples are therefore inline at their response media types so their outcomes compile.
- Default protocol-error adaptation chooses an operation-declared status and schema-valid tuple, but it cannot infer which domain error caused an arbitrary invalid body. Exact causal errors are exposed as named outcomes and HTTP scenarios instead of publishing private decision logic.
- The connect handler accepts an untyped `pull_configuration.mandate` value, while the existing public contract documents only `enabled`. No normative public shape or safe synthesis contract was found for that value, so it remains deliberately unpublished rather than exposing an arbitrary implementation payload.
- The inexpressible relationships already catalogued in `SIMILE_SOUNDNESS.md` remain unresolved: heterogeneous order-total reconstruction, discriminator-crossing currency and aggregate rules, current-time-derived states, payout's private executing timestamp, filtered pagination state, pairwise uniqueness through referenced items, array-wildcard dynamic bounds, conditional disjunction, header/body equality, and error-URL lookup priority.
- Most operations still retain schema-synthesized outcomes in addition to the reviewed exact catalog. Those are contract-valid approximations and are not represented as production-faithful fixtures.

## Validation report

The final validation commands are:

```bash
npm run lint:openapi
npm run test:simile-service
npm run test:request-response-relations
npm run postman:check
npm test
simile compile commerce.yml \
  --behavior simile/principals.hcl \
  --behavior simile/behaviors.hcl \
  --behavior simile/errors.hcl \
  --behavior simile/state.hcl \
  --behavior simile/faults.hcl \
  --artifact /tmp/inttegro.similec \
  --output json
simile audit /tmp/inttegro.similec --output json
simile inspect /tmp/inttegro.similec --output json
SIMILE_HOME="$(mktemp -d)" simile register inttegro \
  --config ./simile/inttegro.simile.hcl \
  --output json
```

Results:

- Redocly: valid OpenAPI; five unused-component warnings. Two are the pre-existing balance-transaction bases; three retain the formerly shared search components so existing component consumers are not broken while operations use stricter route-specific schemas.
- Simile compile: success with compiler 0.3.0, OpenAPI 3.0.3, service version `0.1.0-beta97`, 135 operations, three abstract resources, three async operations, one principal, and three fixture profiles.
- Artifact inspection: format 22, 135 operations, 637 responses, 661 outcomes, 616 schema-synthesized outcomes, 21 provider-authored outcomes, 37 scenario selections, five scenario faults, 29 provider-authored effects, zero convention-inferred effects, two faults, two fault profiles, one security scheme, one principal, three fixture profiles, and `publicExportSafe: true`.
- Fidelity audit: zero errors. Its 165 reviewed warnings comprise 107 operations whose remaining statuses intentionally use schema synthesis and 58 POST operations without effects. Of the latter, 55 are public reads expressed as POST; `sendOrderInvoice` and `sendOrderReceipt` depend on recipient data resolved from the referenced order, and `reconcileFileReferences` is keyed by both public resource type and ID. The HCL action language cannot construct those three effects from the operation payloads without guessing unavailable values or collapsing distinct resources, so they remain explicit rather than approximated.
- Request/response synthesis: all 135 operations synthesized directly without fallback outcomes or request seeds. Four focused regressions additionally exercise zero-valued pagination, protected dynamic bounds, and high policy-version projection.
- Request reachability: 122 operations carry 124 constructive success-payload relations; the remaining 13 operations match the exact reviewed exception inventory. All 124 relation maps are also preserved in both Smithy outputs.
- Supplied requests: all request examples declared directly in OpenAPI replayed successfully, along with bank-account owner-source alternatives, a Dosh marker, bundle Buy links with catalog and special-offer prices, and a complete operating-policy capability snapshot; 16 valid supplied requests ran in total.
- Negative requests: missing financial-account subtype data, missing financial-account owner data, an unsupported mobile-money network, and a contradictory Purchase Intent target/quantity payload were rejected.
- Exact outcomes: all 17 runnable contract selections and all 19 provider-authored domain outcomes returned their expected public payload shape and values. These include complete and partial invoice/receipt delivery, create/update/lookup/cancel Buy-link lifecycle snapshots, and an activated operating-policy version. HTTP-adapter checks additionally proved non-empty binary delivery and exact 302/303 redirect `Location` headers.
- Composition root: `simile describe service inttegro --config ./simile/inttegro.simile.hcl` resolved the contract and all five modules, reporting 135 operations, 42 scenarios, three backends, three async units, two fault profiles, one application principal, three fixture profiles, and one setup workflow at `127.0.0.1:4242`.
- Application setup: isolated registration created a named application profile, issued one redacted bearer credential, preserved the public application identifier, and selected the first profile without exposing sensitive values in setup or profile JSON.
- Stateful HTTP behavior: 17 adapter checks exercised product creation, partial mutation with full-snapshot preservation, lookup, paging, product-price creation, Purchase Intent creation, and order creation. The same product, price, Purchase Intent, and order survived a service restart, while a second independently provisioned application could not read the first application's state before or after restart.
- Full package gate: passed. OpenAPI, Smithy IDL/AST, TypeScript declarations, Insomnia, and Postman agree on all 135 operations; TypeScript compiles; every generated artifact is current; and the reviewed `0.1.0-beta97` contract lock matches.

The full contract gate additionally re-proves 118 typed-ID patterns, 312 public error codes across the declared error families, all 498 operation/status error mappings, 187 allow-listed cross-field relationships with 374 sound/unsound fixture payloads, generated Postman parity, deterministic OpenAPI/Smithy artifacts, and the contract lock.
