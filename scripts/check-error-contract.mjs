import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const openapiDir = resolve(scriptDir, "..");
const specificationPath = resolve(openapiDir, "commerce.yml");
const simile = process.env.SIMILE_BIN ?? resolve(openapiDir, "../simile/target/debug/simile");

if (!existsSync(simile)) {
  throw new Error(`Simile binary not found at ${simile}; set SIMILE_BIN to override it`);
}

const document = YAML.parse(readFileSync(specificationPath, "utf8"));
const schemas = document.components.schemas;
const expectedEnums = new Map([
  ["ErrorCause", 28],
  ["ErrorType", 18],
  ["ErrorFixCode", 16],
  ["ErrorCode", 312],
  ["ErrorDocumentationURL", 17],
]);

for (const [name, expectedSize] of expectedEnums) {
  const schema = schemas[name];
  assert.equal(schema.type, "string", `${name} must remain a string schema`);
  assert.ok(Array.isArray(schema.enum), `${name} must declare a finite enum`);
  assert.equal(schema.enum.length, expectedSize, `${name} public value inventory changed`);
  assert.equal(new Set(schema.enum).size, schema.enum.length, `${name} contains duplicate values`);
  assert.deepEqual(schema.enum, [...schema.enum].sort(), `${name} must remain sorted for reviewability`);
}

for (const code of [
  "endpoint_authentication_required",
  "idempotency_key_mismatch",
  "invalid_request_parameter",
  "payment_method_invalid",
  "payment_transition_conflict",
  "product_not_found",
  "purchase_intent_variant_invalid",
  "request_failed",
  "sms_sender_id_authorization_unavailable",
]) {
  assert.ok(schemas.ErrorCode.enum.includes(code), `ErrorCode is missing ${code}`);
}

// Internal handlers have their own diagnostics, but exposing those values here
// would turn private implementation details into public protocol commitments.
for (const code of [
  "bundle_media_retry_unavailable",
  "customer_create_failed",
  "default_price_cannot_deactivate",
  "internal_endpoint_authorization_denied",
  "notification_create_failed",
  "payment_method_tokenize_failed",
  "product_bundle_mutation_conflict",
  "product_create_failed",
  "refund_process_failed",
  "unknown_error",
]) {
  assert.ok(!schemas.ErrorCode.enum.includes(code), `ErrorCode exposes internal-only value ${code}`);
}

for (const code of schemas.ErrorCode.enum) {
  assert.match(code, /^[a-z][a-z0-9_]*$/, `ErrorCode contains an invalid public value: ${code}`);
}
for (const url of schemas.ErrorDocumentationURL.enum) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://studio.inttegro.com", `error URL escaped Studio: ${url}`);
  assert.ok(parsed.pathname === "/errors" || parsed.pathname.startsWith("/e/"), `unexpected error URL path: ${url}`);
}

const error = schemas.Error;
const machineFields = ["cause", "code", "fix_code", "type", "url"];
assert.equal(error.oneOf?.length, 46, "Error must preserve every authoritative public tuple group");

const coveredCodes = new Set();
let tupleCount = 0;
for (const [index, variant] of error.oneOf.entries()) {
  assert.equal(variant.type, "object", `Error variant ${index} must be an object`);
  for (const property of machineFields) {
    assert.ok(variant.required?.includes(property), `Error variant ${index} does not require ${property}`);
    const values = variant.properties?.[property]?.enum;
    assert.ok(Array.isArray(values) && values.length > 0, `Error variant ${index}.${property} needs an enum`);
    if (property !== "code") {
      assert.equal(values.length, 1, `Error variant ${index}.${property} must be deterministic`);
    }
  }
  for (const code of variant.properties.code.enum) {
    assert.ok(schemas.ErrorCode.enum.includes(code), `Error variant ${index} references unknown code ${code}`);
    coveredCodes.add(code);
    tupleCount += 1;
  }
}
assert.equal(tupleCount, 327, "public error tuple inventory changed");
assert.deepEqual([...coveredCodes].sort(), schemas.ErrorCode.enum, "Error variants do not cover every public code");

const propertyRefs = {
  cause: "#/components/schemas/ErrorCause",
  code: "#/components/schemas/ErrorCode",
  fix_code: "#/components/schemas/ErrorFixCode",
  type: "#/components/schemas/ErrorType",
  url: "#/components/schemas/ErrorDocumentationURL",
};
for (const [property, reference] of Object.entries(propertyRefs)) {
  assert.equal(error.properties[property].allOf?.[0]?.$ref, reference, `Error.${property} bypasses its public enum`);
}

const valid = {
  cause: "invalid_request_parameter",
  code: "payment_method_invalid",
  detail: "use an active payment method that belongs to the order customer.",
  fix_code: "change_request_parameters",
  message: "payment method is invalid",
  type: "invalid_request_parameter",
  url: "https://studio.inttegro.com/errors",
};
const invalidValues = {
  cause: "invented_cause",
  code: "invented_error_code",
  fix_code: "invented_fix",
  type: "invented_type",
  url: "https://example.test/invented-error",
};

const work = mkdtempSync(resolve(tmpdir(), "commerce-error-contract-"));
try {
  const contractPath = resolve(work, "error-contract.yml");
  writeFileSync(contractPath, YAML.stringify(projectedContract()));

  // Multiple fresh runs exercise Simile's random enum selection. Checking the
  // emitted values, rather than only the source YAML, guards the compiler path
  // that previously produced structurally valid but impossible error strings.
  const observed = new Set();
  for (let run = 0; run < 8; run += 1) {
    const result = runSimile([
      "run",
      contractPath,
      "--operation-id",
      "simileErrorContract",
      "--heuristics",
      "off",
      "--output",
      "json",
    ]);
    const payload = JSON.parse(result.stdout);
    for (const [property, reference] of Object.entries(propertyRefs)) {
      if (payload[property] === undefined) continue;
      observed.add(property);
      const enumName = reference.split("/").at(-1);
      assert.ok(schemas[enumName].enum.includes(payload[property]), `Simile invented Error.${property}`);
    }
    assert.ok(matchesErrorVariant(payload), "Simile combined valid fields into an impossible error tuple");
  }
  for (const property of ["code", "type", "url"]) {
    assert.ok(observed.has(property), `Simile did not synthesize required Error.${property}`);
  }

  const validPath = writeRequest("valid", valid);
  runSimile([
    "run",
    contractPath,
    "--operation-id",
    "simileErrorContract",
    "--request",
    validPath,
    "--output",
    "json",
  ], "Simile rejected a public error payload");

  for (const [property, value] of Object.entries(invalidValues)) {
    const invalid = { ...valid, [property]: value };
    const invalidPath = writeRequest(`invalid-${property}`, invalid);
    runSimile([
      "run",
      contractPath,
      "--operation-id",
      "simileErrorContract",
      "--request",
      invalidPath,
      "--output",
      "json",
    ], `Simile accepted an impossible Error.${property}`, false);
  }

  const incoherent = {
    ...valid,
    cause: "resource_not_found",
    fix_code: "refresh_resource_state",
    type: "not_found",
    url: "https://studio.inttegro.com/errors",
  };
  const incoherentPath = writeRequest("incoherent-tuple", incoherent);
  runSimile([
    "run",
    contractPath,
    "--operation-id",
    "simileErrorContract",
    "--request",
    incoherentPath,
    "--output",
    "json",
  ], "Simile accepted individually valid fields in an impossible error tuple", false);

  console.log(
    `Error contract verified: ${schemas.ErrorCode.enum.length} codes, ` +
      `${schemas.ErrorType.enum.length} types, ${schemas.ErrorCause.enum.length} causes, ` +
      `${schemas.ErrorFixCode.enum.length} fix codes, ${schemas.ErrorDocumentationURL.enum.length} URLs`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

function projectedContract() {
  const names = ["Error", ...expectedEnums.keys()];
  return {
    openapi: document.openapi,
    info: { title: "Commerce error contract fixture", version: "1.0.0" },
    paths: {
      "/error-contract": {
        post: {
          operationId: "simileErrorContract",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          responses: {
            "200": {
              description: "Synthetic error response",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
            },
          },
        },
      },
    },
    components: {
      schemas: Object.fromEntries(names.map((name) => [name, schemas[name]])),
    },
  };
}

function writeRequest(name, body) {
  const path = resolve(work, `${name}.json`);
  writeFileSync(path, `${JSON.stringify({ headers: { "Content-Type": "application/json" }, body }, null, 2)}\n`);
  return path;
}

function matchesErrorVariant(payload) {
  return error.oneOf.some((variant) =>
    machineFields.every((property) => variant.properties[property].enum.includes(payload[property])),
  );
}

function runSimile(args, message = "Simile command failed", shouldSucceed = true) {
  const result = spawnSync(simile, args, {
    cwd: openapiDir,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const succeeded = result.status === 0;
  if (succeeded !== shouldSucceed) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${message}\n$ ${simile} ${args.join(" ")}\n${output}`);
  }
  return result;
}
