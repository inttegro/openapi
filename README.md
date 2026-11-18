# Inttegro API

This repository contains the public, machine-readable contract and ready-to-run HTTP collections for the Inttegro API.

## Contents

- [`src/openapi.yml`](src/openapi.yml) — the authoritative modular OpenAPI 3.0.3 source.
- [`src/resources/`](src/resources/) — operations and schemas grouped by public API resource.
- [`commerce.yml`](commerce.yml) — the generated, portable public OpenAPI specification.
- [`smithy/commerce.smithy`](smithy/commerce.smithy) — the generated, readable Smithy 2.0 projection.
- [`commerce.smithy.json`](commerce.smithy.json) — the generated, fully assembled Smithy JSON AST for consumers that need one portable file.
- [`typescript/commerce.d.ts`](typescript/commerce.d.ts) — the generated, types-only contract containing public payloads, operations, constraints, relations, and literal examples.
- [`typescript/proof-kernel.d.ts`](typescript/proof-kernel.d.ts) — the runtime-free type algebra that proves schema paths and request-to-response scenarios.
- [`insomnia/`](insomnia/) — Insomnia v5.1 collections covering the public API.
- [`postman/`](postman/) — equivalent Postman Collection v2.1 artifacts generated from Insomnia.

The published files contain no credentials, cookies, private infrastructure details, or live capability URLs.

This contract contains only operations intended for API consumers using documented public authentication. Service-only and operator-only routes do not belong in the specification or client collections.

## Versions

OpenAPI, Smithy, the types-only contract, Insomnia, and Postman are released as one collection bundle. The bundle version is declared by `info.version` and `info.x-inttegro-collection-version` in `src/openapi.yml`, copied into `commerce.yml`, Smithy, and the TypeScript declaration contract, exposed as `collection_version` in the shared client environment, and written to every generated Postman collection.

The contract test requires all representations to carry the same version. It also refuses to refresh the reviewed contract lock after an artifact changes unless the collection version is bumped. Insomnia schema 5.1 and Postman Collection 2.1 are file-format versions; they are independent of the Inttegro collection bundle version.

## Use the OpenAPI specification

Import `commerce.yml` into any OpenAPI 3.0-compatible client, generator, or validator. The production server URL is declared in the specification.

Edit `src/openapi.yml` and the relevant file under `src/resources/`; do not edit the generated `commerce.yml` directly. Resource files intentionally collocate operations, schemas, examples, and their rationale comments while the generated bundle remains portable for clients that do not resolve external references.

Regenerate and verify the portable specification with:

```sh
npm run openapi:bundle
npm run openapi:check
```

Validate the specification with:

```sh
npm run lint:openapi
```

## Use the Smithy specification

Consumers that work with Smithy can load `smithy/commerce.smithy` as Smithy 2.0 IDL. Consumers that require a single final artifact can load `commerce.smithy.json`; it is the compiled JSON AST and includes the model dependency closure, so it does not rely on local source discovery.

OpenAPI remains the authored authority for the HTTP contract. The Smithy files are deterministic projections of `commerce.yml`, not a second hand-maintained contract. The projection uses Smithy-native HTTP, authentication, validation, examples, errors, and operation traits wherever Smithy can represent the behavior directly. It retains `x-simile-constraints`, records the exact OpenAPI source digest on the service, preserves OpenAPI-only schema fragments under `x-inttegro-openapi-source-schema`, preserves multi-success response alternatives under `x-inttegro-http-success-responses`, and carries each operation's status/content-type request-to-response bindings under `x-inttegro-simile-response-relations`. Those fidelity extensions are machine-readable evidence for semantics that generic Smithy validators cannot enforce natively.

Generation is pinned to Smithy CLI 1.75.0 and smithytranslate 0.7.10. Install the Smithy CLI, then install the translator with Coursier:

```sh
cs install --channel https://disneystreaming.github.io/coursier.json smithytranslate:0.7.10
```

Regenerate, prove reproducibility, or compile the readable IDL directly with:

```sh
npm run smithy:bundle
npm run smithy:check
npm run smithy:compile
```

## Use the types-only contract

Consumers that use TypeScript's type system can load `typescript/commerce.d.ts`
without installing or executing a runtime library. `RequestBody`,
`ResponseBody`, and `ResponseRelation` expose each operation's payloads and
soundness proposition. `SchemaDefinitions`, `SchemaConstraintSites`, and
`OperationExamples` expose the closed source algebra when a consumer needs to
inspect or prove the contract itself.

The declarations retain all 601 public schemas, all 135 operations, all 238
cross-field constraints, all 111 request-to-response relations, and every
named example. The included `createOrder` proof establishes the documented
request and response as a valid witness and proves that incorrect totals,
currencies, lifecycle branches, and operation error codes are rejected.

This projection deliberately contains declarations only: `tsc` emits no
JavaScript. OpenAPI remains the authored HTTP authority while the type-system
form is evaluated. See [`typescript/README.md`](typescript/README.md) for the
consumer API and proof layout.

Regenerate and type-check it with:

```sh
npm run typescript:bundle
npm run typescript:check
npm run typescript:compile
```

## Use the Insomnia collections

Follow [`insomnia/README.md`](insomnia/README.md) to import the collections, configure a private environment, or run the checkout quickstart with Inso CLI. Keep API keys in a private Insomnia environment, shell environment, or supported external vault; never commit them to this repository.

Validate every Insomnia artifact against the published Insomnia v5.1 schema with:

```sh
cd insomnia
./scripts/validate.sh
```

## Use the Postman collections

Follow [`postman/README.md`](postman/README.md) to import the shared environment and API-area collections or run the safe checkout workflow with Newman.

Postman artifacts are generated from Insomnia. After changing an Insomnia collection, regenerate them with:

```sh
npm run postman:generate
```

## Keep contract formats and collections in sync

The repository treats the modular OpenAPI source, generated OpenAPI, Smithy, and types-only artifacts, Insomnia, and Postman as one public contract. CI first proves that `commerce.yml`, `smithy/commerce.smithy`, `commerce.smithy.json`, and `typescript/commerce.d.ts` are reproducible, compiles every type-level proof, then requires exact operation coverage, validates request examples against the OpenAPI schemas, checks that Postman is an exact generated counterpart of Insomnia, and verifies a reviewed digest that cannot be refreshed after a one-sided OpenAPI or Insomnia change.

Run the same contract gate locally:

```sh
npm ci
npm test
```

When intentionally changing the API contract, update the appropriate OpenAPI resource and Insomnia, regenerate the portable OpenAPI, Smithy, types-only, and Postman artifacts, review them together, and refresh their shared digest. `contract:update` performs all generation steps:

```sh
npm run contract:update
npm test
```

## License

Released under the [MIT License](LICENSE).
