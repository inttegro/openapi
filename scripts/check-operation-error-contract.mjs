import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

import {
  operationErrorCodes,
  operationErrorTupleDefaults,
  operationErrorTupleOverrides,
} from "./operation-error-codes.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const openapiDir = resolve(scriptDir, "..");
const specificationPath = resolve(openapiDir, "commerce.yml");
const simile = process.env.SIMILE_BIN ?? resolve(openapiDir, "../simile/target/debug/simile");
const document = YAML.parse(readFileSync(specificationPath, "utf8"));
const methods = new Set(["get", "post", "put", "patch", "delete"]);
const directErrorSchemas = new Set(["#/components/schemas/Error", "#/components/schemas/FileApiError"]);
const supportedErrorSchemas = new Set([
  ...directErrorSchemas,
  "#/components/schemas/ErrorEnvelope",
  "#/components/schemas/CheckoutOrderErrorResponse",
  "#/components/schemas/OrderErrorResponse",
  "#/components/schemas/OrderDocumentDeliveryErrorResponse",
  "#/components/schemas/UploadRequestValidationErrorResponse",
]);

if (!existsSync(simile)) {
  throw new Error(`Simile binary not found at ${simile}; set SIMILE_BIN to override it`);
}

const operationLocations = new Map();
let statusCount = 0;
for (const [pathName, pathItem] of Object.entries(document.paths)) {
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!methods.has(method)) continue;
    const operationId = operation.operationId;
    assert.ok(operationId, `${method.toUpperCase()} ${pathName} is missing operationId`);
    assert.ok(!operationLocations.has(operationId), `duplicate operationId ${operationId}`);
    operationLocations.set(operationId, { method, pathName });

    const expectedStatuses = operationErrorCodes[operationId];
    assert.ok(expectedStatuses, `${operationId} has no audited error-code inventory`);
    const actualStatuses = Object.entries(operation.responses ?? {})
      .filter(([status, response]) => Number(status) >= 400 && response?.content?.["application/json"]?.schema)
      .map(([status]) => status);
    assert.deepEqual(
      actualStatuses,
      Object.keys(expectedStatuses),
      `${operationId} error status inventory drifted`,
    );

    for (const status of actualStatuses) {
      const schema = operation.responses[status].content["application/json"].schema;
      const reference = schema.allOf?.[0]?.$ref;
      const overlay = schema.allOf?.[1];
      assert.ok(supportedErrorSchemas.has(reference), `${operationId} ${status} has an unsupported error schema`);
      if (!directErrorSchemas.has(reference)) {
        assert.equal(overlay?.type, "object", `${operationId} ${status} is missing its narrowing overlay`);
      }
      const expectedCodes = expectedStatuses[status];
      const tupleNode = directErrorSchemas.has(reference)
        ? overlay
        : overlay.properties?.error;
      const tupleVariants = reference === "#/components/schemas/UploadRequestValidationErrorResponse"
        ? undefined
        : (tupleNode.oneOf ?? [tupleNode]);
      const actualCodes = reference === "#/components/schemas/UploadRequestValidationErrorResponse"
        ? overlay.properties?.error?.properties?.code?.enum
        : [...new Set(tupleVariants?.flatMap((variant) => variant.properties?.code?.enum ?? []))].sort();
      assert.ok(Array.isArray(actualCodes) && actualCodes.length > 0, `${operationId} ${status} has no code enum`);
      assert.deepEqual(actualCodes, expectedCodes, `${operationId} ${status} error codes drifted`);
      assert.deepEqual(actualCodes, [...actualCodes].sort(), `${operationId} ${status} codes must remain sorted`);
      assert.equal(new Set(actualCodes).size, actualCodes.length, `${operationId} ${status} repeats an error code`);
      for (const code of actualCodes) {
        assert.ok(document.components.schemas.ErrorCode.enum.includes(code), `${operationId} ${status} uses unknown ${code}`);
      }
      if (reference !== "#/components/schemas/UploadRequestValidationErrorResponse") {
        assert.ok(Array.isArray(tupleVariants) && tupleVariants.length > 0, `${operationId} ${status} has no error tuples`);
        assert.deepEqual(
          tupleVariants,
          selectTupleVariants(operationId, status, expectedCodes),
          `${operationId} ${status} tuple constructors drifted`,
        );
      }
      statusCount += 1;
    }
  }
}

assert.deepEqual(
  [...operationLocations.keys()].sort(),
  Object.keys(operationErrorCodes).sort(),
  "operation error inventory contains missing or obsolete operations",
);
assert.equal(operationLocations.size, 135, "public operation inventory changed");
assert.equal(statusCount, 498, "public operation/status error inventory changed");

for (const [key, overrides] of Object.entries(operationErrorTupleOverrides)) {
  const split = key.lastIndexOf(":");
  const operationId = key.slice(0, split);
  const status = key.slice(split + 1);
  assert.ok(operationErrorCodes[operationId]?.[status], `tuple override ${key} targets no public error response`);
  for (const [code, tuple] of Object.entries(overrides)) {
    assert.ok(operationErrorCodes[operationId][status].includes(code), `tuple override ${key} targets absent ${code}`);
    assert.ok(tupleExists(code, tuple), `tuple override ${key}.${code} is not globally public`);
  }
}
for (const [code, tuple] of Object.entries(operationErrorTupleDefaults)) {
  assert.ok(tupleExists(code, tuple), `default tuple override for ${code} is not globally public`);
}

// Why: exercising every wrapper family proves that the overlay reaches the actual code field,
// rather than merely looking correct in YAML while Simile synthesizes through the shared schema.
const representativeCases = [
  ["initiateOTP", "400"],
  ["createCustomer", "400"],
  ["payCheckout", "400"],
  ["confirmPayment", "409"],
  ["sendOrderInvoice", "400"],
  ["createFile", "400"],
  ["fulfillUploadRequest", "400"],
];
const work = mkdtempSync(resolve(tmpdir(), "commerce-operation-errors-"));
try {
  const projected = projectedContract();
  const contractPath = resolve(work, "operation-errors.yml");
  writeFileSync(contractPath, YAML.stringify(projected));
  runSimile([
    "compile",
    contractPath,
    "--artifact",
    resolve(work, "operation-errors.simile"),
    "--heuristics",
    "off",
    "--output",
    "json",
  ]);

  representativeCases.forEach(([operationId, status], index) => {
    const syntheticOperationId = `simileOperationError${index}`;
    const result = runSimile([
      "run",
      contractPath,
      "--operation-id",
      syntheticOperationId,
      "--heuristics",
      "off",
      "--output",
      "json",
    ]);
    const sound = JSON.parse(result.stdout);
    const allowed = operationErrorCodes[operationId][status];
    const reference = responseSchema(operationId, status).allOf[0].$ref;
    const soundCode = directErrorSchemas.has(reference) ? sound.code : sound.error.code;
    assert.ok(allowed.includes(soundCode), `Simile synthesized ${soundCode} for ${operationId} ${status}`);

    const soundPath = writeRequest(`sound-${index}`, sound);
    runSimile([
      "run",
      contractPath,
      "--operation-id",
      syntheticOperationId,
      "--request",
      soundPath,
      "--output",
      "json",
    ], `${operationId} ${status} rejected its synthesized sound payload`);

    const unsound = unsoundPayload(sound, reference, allowed);
    const unsoundPath = writeRequest(`unsound-${index}`, unsound);
    runSimile([
      "run",
      contractPath,
      "--operation-id",
      syntheticOperationId,
      "--request",
      unsoundPath,
      "--output",
      "json",
    ], `${operationId} ${status} accepted an operation-inapplicable error`, false);
  });

  console.log(
    `Operation error contract verified: ${operationLocations.size} operations, ` +
      `${statusCount} statuses, ${representativeCases.length} wrapper families synthesized`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

function projectedContract() {
  const paths = {};
  representativeCases.forEach(([operationId, status], index) => {
    const sourceSchema = responseSchema(operationId, status);
    const reference = sourceSchema.allOf[0].$ref;
    // Why: the full upload-attempt snapshot has its own large lifecycle search space; this
    // projection isolates the error-code relationship so a synthesis failure cannot be
    // mistaken for evidence about the operation-specific enum.
    const schema = reference === "#/components/schemas/UploadRequestValidationErrorResponse"
      ? uploadValidationErrorProjection(sourceSchema)
      : structuredClone(sourceSchema);
    paths[`/__simile_operation_error/${index}`] = {
      post: {
        operationId: `simileOperationError${index}`,
        requestBody: {
          required: true,
          content: { "application/json": { schema } },
        },
        responses: {
          "200": {
            description: "Synthetic operation-specific error response",
            content: { "application/json": { schema } },
          },
        },
      },
    };
  });
  return {
    openapi: document.openapi,
    info: { title: "Commerce operation error contract fixture", version: "1.0.0" },
    paths,
    components: document.components,
  };
}

function uploadValidationErrorProjection(sourceSchema) {
  const codes = sourceSchema.allOf[1].properties.error.properties.code.enum;
  return {
    type: "object",
    additionalProperties: false,
    required: ["error"],
    properties: {
      error: {
        type: "object",
        additionalProperties: false,
        required: ["code", "message", "retryable"],
        properties: {
          code: { type: "string", enum: codes },
          message: { type: "string" },
          retryable: { type: "boolean" },
        },
      },
    },
  };
}

function responseSchema(operationId, status) {
  const { method, pathName } = operationLocations.get(operationId);
  return document.paths[pathName][method].responses[status].content["application/json"].schema;
}

function unsoundPayload(sound, reference, allowed) {
  const disallowed = document.components.schemas.ErrorCode.enum.find((code) => !allowed.includes(code));
  assert.ok(disallowed, "representative operation unexpectedly permits every public error code");
  if (reference === "#/components/schemas/UploadRequestValidationErrorResponse") {
    const payload = structuredClone(sound);
    payload.error.code = disallowed;
    return payload;
  }
  const error = errorForCode(disallowed);
  if (directErrorSchemas.has(reference)) return error;
  const payload = structuredClone(sound);
  payload.error = error;
  return payload;
}

function errorForCode(code) {
  const variant = document.components.schemas.Error.oneOf.find((candidate) =>
    candidate.properties.code.enum.includes(code),
  );
  assert.ok(variant, `no coherent global Error tuple exists for ${code}`);
  return {
    cause: variant.properties.cause.enum[0],
    code,
    fix_code: variant.properties.fix_code.enum[0],
    type: variant.properties.type.enum[0],
    url: variant.properties.url.enum[0],
  };
}

function selectTupleVariants(operationId, status, codes) {
  const rules = {
    ...operationErrorTupleDefaults,
    ...(operationErrorTupleOverrides[`${operationId}:${status}`] ?? {}),
  };
  const variants = [];
  for (const globalVariant of document.components.schemas.Error.oneOf) {
    const selectedCodes = globalVariant.properties.code.enum.filter((code) =>
      codes.includes(code) && (!rules[code] || tupleMatches(globalVariant, rules[code]))
    );
    if (selectedCodes.length === 0) continue;
    const variant = structuredClone(globalVariant);
    variant.properties.code.enum = selectedCodes;
    variants.push(variant);
  }
  assert.deepEqual(
    [...new Set(variants.flatMap((variant) => variant.properties.code.enum))].sort(),
    [...codes].sort(),
    `${operationId} ${status} has codes without a constructible tuple`,
  );
  return variants;
}

function tupleExists(code, tuple) {
  return document.components.schemas.Error.oneOf.some((variant) =>
    variant.properties.code.enum.includes(code) && tupleMatches(variant, tuple)
  );
}

function tupleMatches(variant, tuple) {
  return ["cause", "fix_code", "type", "url"].every((field) =>
    variant.properties?.[field]?.enum?.[0] === tuple[field]
  );
}

function writeRequest(name, body) {
  const path = resolve(work, `${name}.json`);
  writeFileSync(path, `${JSON.stringify({ headers: { "Content-Type": "application/json" }, body }, null, 2)}\n`);
  return path;
}

function runSimile(args, message = "Simile command failed", shouldSucceed = true) {
  const result = spawnSync(simile, args, {
    cwd: openapiDir,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const succeeded = result.status === 0;
  if (succeeded !== shouldSucceed) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${message}\n$ ${simile} ${args.join(" ")}\n${output}`);
  }
  return result;
}
