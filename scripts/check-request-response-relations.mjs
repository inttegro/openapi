import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { relationExceptions } from "./request-response-relation-exceptions.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const openapiDir = resolve(scriptDir, "..");
const specificationPath = resolve(openapiDir, "commerce.yml");
const document = YAML.parse(readFileSync(specificationPath, "utf8"));
const methods = new Set(["delete", "get", "patch", "post", "put"]);

const operations = collectOperations();
const operationIds = new Set(operations.map(({ operationId }) => operationId));
const duplicateIds = operations
  .map(({ operationId }) => operationId)
  .filter((operationId, index, ids) => ids.indexOf(operationId) !== index);
assert.deepEqual(duplicateIds, [], "operationIds must be unique before relation coverage is checked");

for (const operationId of relationExceptions.keys()) {
  assert.ok(operationIds.has(operationId), `stale request-response exception for missing operation ${operationId}`);
}

let relationBlocks = 0;
let coveredOperations = 0;
const uncovered = [];

for (const operation of operations) {
  const successMedia = collectSuccessMedia(operation);
  assert.ok(
    successMedia.length > 0,
    `${operation.operationId} has no declared success response body to audit`,
  );

  const missing = successMedia.filter(({ media }) => media["x-simile-from-request"] === undefined);
  const present = successMedia.filter(({ media }) => media["x-simile-from-request"] !== undefined);
  relationBlocks += present.length;

  for (const { status, contentType, media } of present) {
    assert.ok(media.schema, `${operation.operationId} ${status} ${contentType} relation has no response schema`);
    const relation = media["x-simile-from-request"];
    assert.ok(
      relation && typeof relation === "object" && !Array.isArray(relation),
      `${operation.operationId} ${status} ${contentType} relation must be an object`,
    );
    assert.ok(
      Array.isArray(relation.bindings) || Array.isArray(relation.rules),
      `${operation.operationId} ${status} ${contentType} relation has neither bindings nor rules`,
    );
    const requestSchema = operation.operation.requestBody?.content?.[contentType]?.schema;
    for (const binding of relation.bindings ?? []) {
      if (typeof binding.from !== "string" || typeof binding.to !== "string") continue;
      // Why: copying an unconstrained string into a typed response ID makes synthesis fail or
      // permits an impossible selector. The request domain must preserve the response ID type.
      assertCompatiblePatterns(
        requestSchema,
        binding.from,
        media.schema,
        binding.to,
        `${operation.operationId} ${status} ${contentType}`,
      );
    }
  }

  if (relationExceptions.has(operation.operationId)) {
    assert.equal(
      present.length,
      0,
      `${operation.operationId} now has a request-response relation; remove its stale exception`,
    );
    uncovered.push(operation.operationId);
    continue;
  }

  assert.deepEqual(
    missing.map(({ status, contentType }) => `${status} ${contentType}`),
    [],
    `${operation.operationId} has success payloads without x-simile-from-request`,
  );
  coveredOperations += 1;
}

assert.deepEqual(
  uncovered.sort(),
  [...relationExceptions.keys()].sort(),
  "request-response exception inventory drifted",
);

console.log(
  `Request-response reachability verified: ${coveredOperations}/${operations.length} operations, ` +
    `${relationBlocks} success payload relations, ${relationExceptions.size} documented exceptions`,
);

function collectOperations() {
  const result = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(item ?? {})) {
      if (!methods.has(method)) continue;
      assert.ok(operation?.operationId, `${method.toUpperCase()} ${path} has no operationId`);
      result.push({ method, path, operationId: operation.operationId, operation });
    }
  }
  return result;
}

function collectSuccessMedia({ operationId, operation }) {
  const result = [];
  for (const [status, response] of Object.entries(operation.responses ?? {})) {
    if (!/^2\d\d$/.test(status)) continue;
    for (const [contentType, media] of Object.entries(response?.content ?? {})) {
      assert.ok(media && typeof media === "object", `${operationId} ${status} ${contentType} media is invalid`);
      result.push({ status, contentType, media });
    }
  }
  return result;
}

function assertCompatiblePatterns(requestSchema, from, responseSchema, to, label) {
  assert.ok(requestSchema, `${label} relation has no compatible request schema`);
  const sourceSchemas = schemasAt(requestSchema, from);
  const targetSchemas = schemasAt(responseSchema, to);
  assert.ok(sourceSchemas.length > 0, `${label} request path ${from} does not resolve`);
  assert.ok(targetSchemas.length > 0, `${label} response path ${to} does not resolve`);

  const targetPatterns = new Set(targetSchemas.map((schema) => schema.pattern).filter(Boolean));
  if (targetPatterns.size === 0) return;
  const sourcePatterns = new Set(sourceSchemas.map((schema) => schema.pattern).filter(Boolean));
  assert.ok(
    [...targetPatterns].every((pattern) => sourcePatterns.has(pattern)),
    `${label} ${from} patterns ${[...sourcePatterns].join(", ") || "<absent>"} are incompatible ` +
      `with ${to} (${[...targetPatterns].join(", ")})`,
  );
}

function schemasAt(schema, pointer) {
  const segments = pointer.split("/").slice(1).map(decodePointerSegment);
  let candidates = [schema];
  for (const segment of segments) {
    candidates = candidates.flatMap((candidate) => stepSchema(candidate, segment));
  }
  return candidates.map(dereferenceSchema);
}

function stepSchema(schema, segment) {
  schema = dereferenceSchema(schema);
  if (!schema || typeof schema !== "object") return [];
  if (segment === "*") return schema.items ? [dereferenceSchema(schema.items)] : [];

  const result = [];
  if (schema.properties?.[segment]) result.push(dereferenceSchema(schema.properties[segment]));
  for (const keyword of ["allOf", "oneOf", "anyOf"]) {
    for (const branch of schema[keyword] ?? []) result.push(...stepSchema(branch, segment));
  }
  return result;
}

function dereferenceSchema(schema) {
  const seen = new Set();
  while (schema?.$ref) {
    assert.ok(schema.$ref.startsWith("#/"), `external reference remained in bundled contract: ${schema.$ref}`);
    assert.ok(!seen.has(schema.$ref), `cyclic schema reference ${schema.$ref}`);
    seen.add(schema.$ref);
    schema = schema.$ref
      .split("/")
      .slice(1)
      .map(decodePointerSegment)
      .reduce((value, segment) => value?.[segment], document);
  }
  return schema;
}

function decodePointerSegment(segment) {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}
