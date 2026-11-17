# Simile payload-soundness audit

This audit covers the public request and response schemas in `commerce.yml`. The constraints below
come from public serializer behavior, domain validation, tests, and normative schema descriptions.
They deliberately exclude persistence mechanics, provider internals, and operational bookkeeping
that a caller cannot prove from a payload.

All paths below are absolute JSON Pointers relative to the object that owns the
`x-simile-constraints` extension. Simile compilation is the type check: it rejects unresolved
pointers, incompatible predicates, contradictory relationships, and relationships that it cannot
construct during synthesis.

## Constraint inventory

| Schema location | Relationships | Public business invariant |
| --- | --- | --- |
| `/components/schemas/PolicyAmountRange` | 1 `bounded` | A policy's inclusive minimum cannot exceed its required maximum. |
| `/components/schemas/ChildrenPolicy` | 1 `bounded`, 1 `ordered` | A historical policy version cannot exceed the active version; creation, version creation, and update times are chronological. |
| `/components/schemas/ChildrenPolicyVersionsPage` | 1 `aggregate(count)` | `count` equals the number of version snapshots returned; `size` remains the requested capacity. |
| `/components/schemas/OperatingPolicy` | 1 `bounded`, 1 `ordered` | A historical operating-policy version cannot exceed the active version; its public timestamps are chronological. |
| `/components/schemas/OperatingPolicyVersionsPage` | 1 `aggregate(count)` | `count` equals the number of operating-policy versions returned. |
| `/components/schemas/ResourceSearchPage` | 1 `aggregate(count)` | Ariadne's `result_count` equals the number of public search results in the payload. |
| `/components/schemas/SecretKeyPage` | 1 `aggregate(count)` | `count` equals the returned key count; `size` remains the requested capacity. |
| `/components/schemas/SecretKeyUsagePage` | 1 `aggregate(count)` | `count` equals the returned secret-key usage-row count. |
| `/components/schemas/FilePage` | 1 `aggregate(count)` | `size` equals the number of files returned. |
| `/components/schemas/FileLinkPage` | 1 `aggregate(count)` | `size` equals the number of file links returned. |
| `/components/schemas/UploadRequestPage` | 1 `aggregate(count)` | `size` equals the number of upload requests returned. |
| `/components/schemas/CustomerPage` | 1 `aggregate(count)` | `size` equals the number of customers returned. |
| `/components/schemas/CreatePurchaseIntentRequest/properties/quantity` | 1 `bounded` | An optional maximum Buy-link quantity cannot be below the required minimum. |
| `/components/schemas/UpdatePurchaseIntentRequestFields/properties/quantity` | 1 `bounded` | Replacement Buy-link quantity bounds preserve `max >= min`. |
| `/components/schemas/PagePurchaseIntentsResponse/properties/page` | 1 `aggregate(count)` | `size` equals the number of purchase intents actually returned. |
| `/components/schemas/PurchaseIntent/properties/quantity` | 1 `bounded` | The returned optional maximum quantity cannot be below the minimum. |
| `/components/schemas/PricePageResponse/properties/page` | 1 `aggregate(count)` | `size` equals the number of prices returned. |
| `/components/schemas/CustomerSelectedAmountParams` | 1 `bounded` | An optional maximum customer-selected amount cannot be below the required minimum. |
| `/components/schemas/CustomerSelectedAmount` | 1 `bounded` | The returned optional maximum customer-selected amount cannot be below the minimum. |
| `/components/schemas/MessageTemplatesPage` | 1 `aggregate(count)` | `size` equals the number of templates returned after filtering. |
| `/components/schemas/OrderDocumentDelivery` | 1 `set(disjoint)` | A delivery channel cannot be both accepted and failed in the same attempt result. |
| `/components/schemas/PaymentMethodPageResponse/properties/page` | 1 `aggregate(count)` | `size` equals the number of payment methods returned after hydration/filtering. |
| `/components/schemas/CheckoutOrder` | 3 `ordered`, 7 `implies`, 2 `equal` | Order lifecycle timestamps agree with status, terminal branches are mutually coherent, and a present payment has exactly the order total and currency. |
| `/components/schemas/CheckoutOrder/properties/payment` | 4 `ordered`, 10 `implies` | Payment timestamps are chronological; action, overdue, processing, success, failure, cancellation, expiry, and compatibility `unknown` snapshots cannot contradict their public evidence. |
| `/components/schemas/OrderPaymentMethod` | 1 `ordered`, 6 `implies` | Verification cannot predate tokenization, an unverified method has no verification timestamp, and exactly the public details for the selected payment rail are exposed. |
| `/components/schemas/OrderPaymentAttempt` | 1 `ordered`, 2 `implies` | A successful attempt has a success timestamp and a success timestamp identifies a successful attempt. |
| `/components/schemas/Order` | 3 `ordered`, 7 `implies`, 2 `equal` | The authenticated order projection has the same lifecycle and exact payment-total invariants as checkout. |
| `/components/schemas/Order/properties/payment` | 4 `ordered`, 10 `implies` | The authenticated payment projection has the same chronological and state/evidence invariants as checkout. |
| `/components/schemas/Order/properties/payment/properties/latest_attempt` | 1 `ordered`, 2 `implies` | The inline latest-attempt projection has the same success timestamp equivalence as `OrderPaymentAttempt`. |
| `/components/schemas/RefundLineItem` | 1 `equal`, 1 `bounded` | Original and refunded amounts use one currency, and a line cannot refund more than was originally paid. |
| `/components/schemas/Refund` | 1 `lifecycle`, 5 `implies`, 1 `equal`, 1 `aggregate`, 1 `ordered` | Refund transitions form an acyclic lifecycle; failure and cancellation metadata match status; all lines share the refund currency; line refunds sum to the total; and the total does not exceed the captured order amount. |
| `/components/schemas/RefundPage` | 1 `aggregate(count)` | `size` equals the number of refunds returned. |
| `/components/schemas/BalanceTransactionAllocationBase` | 1 `ordered`, 1 `equal`, 3 `implies` | An allocation completion is chronological, completion is equivalent to the completed state, and `completed_at` is the committed `updated_at` instant. |
| `/components/schemas/BalanceTransactionRefundAllocation` | 1 `ordered`, 1 `equal`, 3 `implies` | The concrete refund allocation preserves the base allocation lifecycle after flattening the closed OpenAPI 3.0 composition. |
| `/components/schemas/BalanceTransactionPayoutAllocation` | 1 `ordered`, 1 `equal`, 3 `implies` | The concrete payout allocation preserves the base allocation lifecycle after flattening the closed OpenAPI 3.0 composition. |
| `/components/schemas/PaymentBalanceTransaction` | 1 `equal`, 1 `equation` | Original, available, pending, and spent amounts use one currency, and the original value equals the complete available + pending + spent partition. |
| `/components/schemas/Payout` | 3 `ordered`, 7 `implies`, 1 `equal`, 1 `bounded`, 1 `aggregate(sum)` | Public payout state, terminal timestamps, failure/cancellation objects, and the deprecated error projection agree; contribution currencies agree; allocated contributions sum to the sealed amount; and the amount is bounded by the maximum. |
| `/components/schemas/PayoutBalanceTransaction` | 1 `equal`, 1 `bounded` | A contribution uses the source transaction currency and cannot allocate more than the source amount. |
| `/components/schemas/PayoutAmountLimits` | 1 `bounded` | A required payout minimum cannot exceed its required maximum. |
| `/components/schemas/FinancialAccountPage` | 1 `aggregate(count)` | `size` equals the number of financial accounts returned. |
| `/components/schemas/PaymentMethodObject` | 3 `ordered`, 1 `equal`, 11 `implies` | Supply precedes tokenization; archival disables reuse; verification is chronological and exposes one completion instant; and rail-specific details agree with `type`. |
| `/components/schemas/PaymentMethodObject/properties/mobile_money` | 1 `template` | The returned account number is exactly `****` plus `last4`; synthesis cannot expose a raw mobile-money account. |
| `/components/schemas/PageChimesResponse/properties/page` | 1 `aggregate(count)` | `size` equals the number of Chimes returned. |
| `/components/schemas/ChimeSMSSettings` | 1 `bounded` | The minimum sender length cannot exceed the required maximum. |
| `/components/schemas/PageOrdersResponse/properties/page` | 1 `aggregate(count)` | `size` equals the number of orders returned. |
| `/components/schemas/PageProductsResponse/properties/page` | 1 `aggregate(count)` | `size` equals the number of products returned. |
| `/components/schemas/OTPTransaction` | 3 `ordered`, 7 `implies` | Expiry, cancellation, and delivery timestamps cannot predate initiation; cancellation metadata agrees with status; and pending delivery/verification states agree with transmission evidence. |

The audit also uses ordinary OpenAPI keywords for local rules: positive order quantities and money
values, nonempty refund and payout contribution arrays, fixed masked-account lengths, the
`processing` payment status already emitted by the implementation, and anchored type-prefix
patterns on 118 public resource-identifier fields. The public `Error` machine fields (`cause`,
`code`, `fix_code`, and `type`) are finite enums taken from public error constructors and the
documented error catalog; `url` is likewise limited to the canonical Studio error pages. The
`Error.oneOf` variants then bind those fields into the 327 complete tuples emitted by public
constructors, so synthesis cannot combine individually valid values into a nonexistent error.
Twelve unused constant- or catalog-only names are deliberately excluded because no public response
constructs them. Those ID patterns follow the public
serializers and their domain constants (`app`, `sk`, `file`, `prod`, `sale`, `or`, `py`, `rf`,
`bt`, `po`, `ch`, and the other allow-listed types); polymorphic and provider-owned identifiers are
deliberately excluded. The balance-transaction schemas were flattened from closed `allOf`
compositions because OpenAPI 3.0 applies
`additionalProperties: false` inside each branch; the former composition admitted no instance.
The component names, JSON fields, required fields, descriptions, and operation references remain
the same.

## New-language delta and evidence

- `bounded` replaces numeric `ordered` clauses where one public scalar is explicitly a dynamic
  bound for another. The relationships were already enforced by the policy, Purchase Intent,
  customer-selected-price, refund, payout, and Chime validators; the new clause makes the direction
  of the bound constructive instead of merely chronological. Representative sources include
  `censor/app/operatingpolicy/constraints.go`, `upper/purchaseintent/create.go`,
  `upper/purchaseintent/update.go`, `upper/price/selectedamount/selected_amount.go`,
  `upper/refund/refund.go`, `upper/payout`, and `mercurio/senderid/service.go`.
- `aggregate(count)` now covers every page whose serializer constructs its reported count or size
  from the returned slice. Evidence is in the corresponding page builders:
  `censor/app/{childrenpolicy,operatingpolicy}/page.go`,
  `censor/secretkey/readmodel/readmodel.go`, `upper/ariadne/translation.go`,
  `octo/{file,filelink,uploadrequest}`, `upper/{customer,purchaseintent,price,paymentmethod,refund,fa,order,product}`,
  and `mercurio/{messagetemplate,chime}`.
- `set(disjoint)` on `OrderDocumentDelivery` follows
  `upper/order/document/delivery.go`: every prepared channel is attempted once and appended to
  either `Sent` or `Failed`, while the public serializer projects those two result sets.

No new `multiply`, `aggregate(min)`, or `aggregate(max)` clause was added. The audited public
schemas do not expose a proven derived target that those operators can construct without crossing
a polymorphic branch or inventing a field.

## Operation-specific error soundness

Every one of the 135 public operations now narrows each declared error response to the public
error tuples that its handler and shared HTTP middleware can emit at that status. The 498 audited
operation/status pairs retain their existing direct-error or error-envelope shape; the response
schema intersects that shape with a pre-filtered `oneOf` tuple subset. The full tuple, rather than
only `code`, is repeated in the subset because this gives Simile a constructive branch and prevents
it from searching the unrelated 45-branch global union.

The inventory in `scripts/operation-error-codes.mjs` comes from endpoint registrations, handler
interpreters, shared authentication, authorization, availability, idempotency and request-parameter
middleware, plus endpoint tests. It is checked against every error status in the specification, so
adding an operation or status without auditing its public codes fails the contract test. The audit
also added 23 already-emitted public codes that were absent from `ErrorCode`, filled the JSON schema
on 66 already-declared error responses, and added the documented
503 response for Chime paging when customer resolution is temporarily unavailable. These are
existing public behaviors made explicit; no success or request shape changed.

## Unsupported soundness requirements

These are genuine invariants, but approximating them with another relationship would weaken or
misstate the public contract:

- An order total cannot yet be reconstructed from its heterogeneous line items. Simile now supports
  multiplication, but the public product-line schema has no per-item extended-amount target, fees
  and shipping are different union branches, and discounts are conditional. A selector through the
  line-item `oneOf` also does not currently resolve. The same selector limitation prevents asserting
  all line currencies equal the order total currency.
- A payment balance transaction cannot assert that the nested amount on every polymorphic refund or
  payout allocation has the source transaction currency. The required selector crosses the
  allocation discriminator. Likewise, pending and spent subtotals would require filtering array
  items by allocation status before aggregation.
- The embedded `OrderPaymentMethod` cannot compose its parent rail discriminator with a nested
  masked-number template in the current compiler. Its fields have enforced lengths, but the
  account-number/`last4` derivation remains uncompiled there. The standalone `PaymentMethodObject`
  does carry the template.
- `last4` is documented as decimal digits. Simile currently compiles string lengths but not the
  OpenAPI `pattern` keyword, so a digit-class rule would not survive compilation or synthesis.
- Several incoming identifier fields intentionally accept either a typed public ID or its raw value.
  A strict type-prefix pattern would reject behavior supported by the request parsers, while an
  optional-prefix pattern would still let synthesis choose an untyped value. Response identifiers
  with serializer-enforced types are constrained; permissive inputs remain reported here instead of
  being made deceptively strict.
- `FinancialAccountWalletResponse` normally emits an `fw_` ID, but the legacy update projection
  reuses that schema while returning the raw wallet ID. A single strict pattern would contradict one
  of those public shapes, so this needs separate typed and legacy schemas before it can be enforced.
- `overdue` payment state depends on the current clock, and `processing` depends on execution-claim
  fields that are intentionally private. The public constraints can exclude contradictory terminal
  evidence but cannot reconstruct those states completely.
- OTP `verified` and `expired` states depend on a nonpublic verification timestamp and a current-time
  comparison. Their cancellation metadata is constrained, but full state derivation is not
  payload-provable.
- The payout `executing` transition timestamp is not public, so the payout state graph cannot be
  represented as one complete `lifecycle` clause. The exposed branches are constrained with
  implications instead.
- The deprecated payout `error` object is a renamed, sanitized projection of `failure`; field-level
  equality would require a mapping/transformation operator. The contract enforces co-presence and
  absence without pretending the differently shaped objects are equal.
- Pagination `count` and returned `size` fields are now enforced with `aggregate(count)`. `has_more`
  still depends on omitted collection state, the requested page capacity, or a next-page probe and
  is not payload-provable from these responses. Dynamic currency maps still need access to an object
  key as a value.
- Refund-line uniqueness and customer-selected suggestion ID/value uniqueness are enforced by their
  domain validators, but the current Simile compiler cannot construct the required pair of distinct
  witnesses through the referenced array-item schemas. Compilation rejects those candidate clauses
  with `distinct source schema must admit at least two constructible values`, so the specification
  keeps its existing references and reports the gap instead of inlining or weakening them.
- Suggested amount values must fall within the enclosing customer-selected minimum and optional
  maximum. `bounded.path` currently rejects an array wildcard, and the optional maximum is not a
  legal required bound source, so that per-item range remains in application validation.
- Conditional message-content alternatives require disjunction (`then.any`), and idempotency
  equality spans an HTTP header and a body rather than one schema object. Neither relationship can
  be encoded with the supported clauses.
- Error documentation URL selection is still a lookup with fallback priority. The global and
  operation-specific schemas enumerate every currently proven tuple, but the relationship cannot be
  reduced to a reusable Simile `template` or equation without a lookup operator.

## Verification

`scripts/check-simile-soundness.mjs` performs three checks:

1. compile the authoritative `commerce.yml` document;
2. expose every changed schema as both a synthetic request and response, then let Simile synthesize
   and validate both directions; and
3. project each individual relationship into an isolated contract and submit one schema-valid
   sound payload plus one schema-valid payload that violates only that relationship.

The test is intentionally allow-listed. Removing a changed schema's constraints or omitting its
relationship tests fails the run instead of silently reducing coverage.

`scripts/check-typed-id-patterns.mjs` separately checks the ordinary OpenAPI rules for all 118
allow-listed typed identifier fields. Every JSON Pointer must resolve to a string schema with the
expected anchored prefix; the test also exercises one matching value and one cross-resource value
per field so removing the anchor or weakening the prefix is visible.

`scripts/check-error-contract.mjs` proves the 312-code global inventory and all 327 coherent public
tuples. `scripts/check-operation-error-contract.mjs` then proves all 135 operation inventories and
498 status mappings, compiles representative projections with Simile, synthesizes every response
wrapper family, accepts a sound payload, and rejects an otherwise globally valid tuple that the
selected operation cannot emit.

The current run compiles the full OpenAPI document (228 total relationships), synthesizes requests
and responses for 47 audited schema locations, and accepts/rejects 330 relationship fixtures across
165 allow-listed relationships.
