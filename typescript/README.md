# Inttegro types-only contract

This directory publishes the Inttegro public contract as TypeScript type
declarations. It contains no runtime JavaScript and does not require an
Inttegro implementation to use.

- `commerce.d.ts` is generated from the portable OpenAPI contract. It contains
  all 601 public schemas, all 135 HTTP operations, every named example, all
  `x-simile-constraints`, and all request-to-response relations.
- `proof-kernel.d.ts` defines the closed type algebra used to interpret schema
  nodes, resolve RFC 6901 paths, evaluate response expressions, and prove
  request-to-response scenarios.
- `create-order.proof.test.d.ts` establishes the published `createOrder`
  request and response as a sound witness. Deliberately incorrect totals,
  currencies, lifecycle branches, and error codes are compile-time failures.
- `relation-algebra.proof.test.d.ts` proves default propagation and derived
  version arithmetic, with contradictory witnesses required to fail.

OpenAPI remains the authored HTTP authority while this representation is being
evaluated. The declaration projection is deterministic, carries the exact
OpenAPI digest, and is locked with the rest of the collection bundle.

Regenerate and verify it with:

```sh
npm run typescript:bundle
npm run typescript:check
npm run typescript:compile
```

Consumers can derive payload types without loading any runtime package:

```ts
import type {
  RequestBody,
  ResponseBody,
  ResponseRelation,
} from "./commerce";

type CreateOrderRequest = RequestBody<"createOrder", "application/json">;
type CreateOrderResponse = ResponseBody<
  "createOrder",
  "200",
  "application/json"
>;
type CreateOrderSoundness = ResponseRelation<
  "createOrder",
  "200",
  "application/json"
>;
```
