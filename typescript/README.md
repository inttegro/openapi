# Inttegro types-only contract

This directory publishes the Inttegro public contract as semantic TypeScript
declarations. It contains no runtime JavaScript and does not require an
Inttegro implementation to use.

- `commerce.d.ts` is the small public entrypoint. It re-exports direct payload
  types, request- and response-direction models, discriminated operation
  results, named examples, business-invariant propositions, and a
  `SoundResponse` proof for request-dependent results from focused modules.
  Source-schema keywords, references, and extension syntax are not its public
  model.
  Direct-field implications are also compiled into payload refinements, so
  incoherent lifecycle combinations fail ordinary TypeScript assignment.
- `core.d.ts`, `models.d.ts`, `input.d.ts`, `output.d.ts`, `soundness.d.ts`,
  `operations.d.ts`, and `examples.d.ts` divide the public contract by
  responsibility. `operations/*.d.ts` divides operation definitions by their
  public contract area without changing the public import path.
- `contract-ir.d.ts` is an internal, lossless compiler projection used to prove
  parity with the authored source document. It is intentionally not the public
  TypeScript contract.
- `proof-kernel.d.ts` defines the closed type algebra used to interpret schema
  nodes, resolve RFC 6901 paths, evaluate response expressions, and prove
  request-to-response scenarios.
- `create-order.proof.test.d.ts` establishes the published `createOrder`
  request and response as a sound witness. Deliberately incorrect totals,
  currencies, lifecycle branches, and error codes are compile-time failures.
- `relation-algebra.proof.test.d.ts` proves default propagation and derived
  version arithmetic, with contradictory witnesses required to fail.
- `public-entrypoint.test.d.ts` proves that the barrel continues to expose
  representative models, inputs, operations, results, and soundness types.

The public declarations are a standalone HTTP contract and carry no dependency
on the format used to generate them. The development-only internal projection
remains deterministic and source-locked for repository parity checks. Keeping
that projection separate prevents source-format machinery from leaking into the
public domain types or Simile's TypeScript frontend.

Regenerate and verify it with:

```sh
npm run typescript:bundle
npm run typescript:check
npm run typescript:compile
```

Consumers can derive payload types without loading any runtime package:

```ts
import type {
  OperationResult,
  RequestBody,
  ResponseBody,
} from "./commerce";

type CreateOrderRequest = RequestBody<"createOrder", "application/json">;
type CreateOrderResponse = ResponseBody<
  "createOrder",
  "200",
  "application/json"
>;
type CreateOrderOutcome = OperationResult<"createOrder">;
```
