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

// These are the object schemas changed by the payload-soundness audit. Keeping
// the allow-list explicit makes removal of either a constraint or its tests visible.
const constrainedObjects = [
  ["components", "schemas", "PolicyAmountRange"],
  ["components", "schemas", "ChildrenPolicy"],
  ["components", "schemas", "ChildrenPolicyVersionsPage"],
  ["components", "schemas", "OperatingPolicy"],
  ["components", "schemas", "OperatingPolicyVersionsPage"],
  ["components", "schemas", "ResourceSearchSort"],
  ["components", "schemas", "ResourceSearchPage"],
  ["components", "schemas", "SecretKeyPage"],
  ["components", "schemas", "SecretKeyUsagePage"],
  ["components", "schemas", "FilePage"],
  ["components", "schemas", "FileLinkPage"],
  ["components", "schemas", "UploadRequestPage"],
  ["components", "schemas", "CustomerPage"],
  ["components", "schemas", "CreatePurchaseIntentRequest", "properties", "quantity"],
  ["components", "schemas", "UpdatePurchaseIntentRequestFields", "properties", "quantity"],
  ["components", "schemas", "PagePurchaseIntentsResponse", "properties", "page"],
  ["components", "schemas", "PurchaseIntent"],
  ["components", "schemas", "PurchaseIntent", "properties", "quantity"],
  ["components", "schemas", "PricePageResponse", "properties", "page"],
  ["components", "schemas", "CustomerSelectedAmountParams"],
  ["components", "schemas", "CustomerSelectedAmount"],
  ["components", "schemas", "MessageTemplatesPage"],
  ["components", "schemas", "OrderDocumentDelivery"],
  ["components", "schemas", "PaymentMethodPageResponse", "properties", "page"],
  ["components", "schemas", "CheckoutOrder"],
  ["components", "schemas", "CheckoutOrder", "properties", "payment"],
  ["components", "schemas", "OrderPaymentMethod"],
  ["components", "schemas", "OrderPaymentAttempt"],
  ["components", "schemas", "Order"],
  ["components", "schemas", "Order", "properties", "payment"],
  ["components", "schemas", "Order", "properties", "payment", "properties", "latest_attempt"],
  ["components", "schemas", "RefundLineItem"],
  ["components", "schemas", "Refund"],
  ["components", "schemas", "RefundPage"],
  ["components", "schemas", "BalanceTransactionAllocationBase"],
  ["components", "schemas", "BalanceTransactionRefundAllocation"],
  ["components", "schemas", "BalanceTransactionPayoutAllocation"],
  ["components", "schemas", "PaymentBalanceTransaction"],
  ["components", "schemas", "Payout"],
  ["components", "schemas", "PayoutBalanceTransaction"],
  ["components", "schemas", "PayoutAmountLimits"],
  ["components", "schemas", "FinancialAccountPage"],
  ["components", "schemas", "PaymentMethodObject"],
  ["components", "schemas", "PaymentMethodObject", "properties", "mobile_money"],
  ["components", "schemas", "PageChimesResponse", "properties", "page"],
  ["components", "schemas", "ChimeSMSSettings"],
  ["components", "schemas", "PageOrdersResponse", "properties", "page"],
  ["components", "schemas", "PageProductsResponse", "properties", "page"],
  ["components", "schemas", "OTPTransaction"],
];

if (!existsSync(simile)) {
  throw new Error(`Simile binary not found at ${simile}; set SIMILE_BIN to override it`);
}

const document = YAML.parse(readFileSync(specificationPath, "utf8"));
const work = mkdtempSync(resolve(tmpdir(), "commerce-simile-soundness-"));

try {
  compileAuthoritativeSpecification();
  synthesizeChangedSchemas();
  const relationshipCount = exerciseEveryRelationship();
  console.log(
    `Simile soundness verified: ${constrainedObjects.length} schemas, ` +
      `${relationshipCount} relationships, ${relationshipCount * 2} fixture payloads`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

function compileAuthoritativeSpecification() {
  runSimile([
    "compile",
    specificationPath,
    "--artifact",
    resolve(work, "commerce.simile"),
    "--output",
    "json",
  ]);
}

function synthesizeChangedSchemas() {
  const augmented = structuredClone(document);
  augmented.paths ??= {};

  constrainedObjects.forEach((location, index) => {
    const schema = location.length === 3
      ? { $ref: `#/components/schemas/${location[2]}` }
      : structuredClone(readAt(augmented, location));
    const seed = schemaSynthesisSeed(location);
    const operationId = `simileSoundnessSchema${index}`;
    augmented.paths[`/__simile_soundness/schema_${index}`] = {
      post: {
        operationId,
        requestBody: {
          required: true,
          content: { "application/json": { schema } },
        },
        responses: {
          "200": {
            description: "Synthetic soundness response",
            content: {
              "application/json": {
                schema,
                ...(seed === undefined ? {} : { examples: { witness: { value: seed } } }),
              },
            },
          },
        },
      },
    };
  });

  const augmentedPath = resolve(work, "changed-schemas.yml");
  writeFileSync(augmentedPath, YAML.stringify(augmented));
  constrainedObjects.forEach((location, index) => {
    const seed = schemaSynthesisSeed(location);
    const args = [
      "run",
      augmentedPath,
      "--operation-id",
      `simileSoundnessSchema${index}`,
    ];
    if (seed !== undefined) {
      // Why: finite generation sometimes chooses a non-empty Purchase Intent page or the more
      // expensive target union. Explicit valid witnesses prove the schema without weakening it.
      args.push("--request", JSON.stringify({ body: seed }));
      args.push("--outcome", "witness");
    }
    args.push("--output", "json");
    runSimile(args);
  });
}

function schemaSynthesisSeed(location) {
  const locationLabel = label(location);
  if (locationLabel === "PagePurchaseIntentsResponse.properties.page") {
    return { number: 1, purchase_intents: [], size: 0 };
  }
  if (locationLabel === "PurchaseIntent") {
    return document.paths["/purchase_intents/create"].post.responses["200"]
      .content["application/json"].examples.created.value.purchase_intent;
  }
  return undefined;
}

function exerciseEveryRelationship() {
  let count = 0;
  for (const location of constrainedObjects) {
    const container = readAt(document, location);
    const constraints = container["x-simile-constraints"];
    assert.ok(Array.isArray(constraints) && constraints.length > 0, `${label(location)} has no constraints`);

    constraints.forEach((constraint, index) => {
      const fixture = relationshipFixture(constraint);
      const caseName = `${label(location)}[${index}].${Object.keys(constraint)[0]}`;
      const contractPath = resolve(work, `relationship-${count}.yml`);
      const soundPath = resolve(work, `relationship-${count}-sound.json`);
      const unsoundPath = resolve(work, `relationship-${count}-unsound.json`);
      writeFileSync(contractPath, YAML.stringify(projectedContract(fixture.schema, constraint, count)));
      // Simile validates the complete request envelope now; wrapping fixtures
      // keeps the relationship proof on the JSON body selected by Content-Type.
      writeFileSync(soundPath, `${JSON.stringify(requestFixture(fixture.sound), null, 2)}\n`);
      writeFileSync(unsoundPath, `${JSON.stringify(requestFixture(fixture.unsound), null, 2)}\n`);

      runSimile([
        "run",
        contractPath,
        "--operation-id",
        `simileSoundnessRelationship${count}`,
        "--request",
        soundPath,
        "--output",
        "json",
      ], `${caseName} rejected its sound payload`);
      runSimile([
        "run",
        contractPath,
        "--operation-id",
        `simileSoundnessRelationship${count}`,
        "--request",
        unsoundPath,
        "--output",
        "json",
      ], `${caseName} accepted its unsound payload`, false);
      count += 1;
    });
  }
  return count;
}

function requestFixture(body) {
  return {
    headers: { "Content-Type": "application/json" },
    body,
  };
}

function projectedContract(schema, constraint, index) {
  schema["x-simile-constraints"] = [constraint];
  return {
    openapi: document.openapi,
    info: { title: "Simile soundness relationship fixture", version: "1.0.0" },
    paths: {
      [`/relationship_${index}`]: {
        post: {
          operationId: `simileSoundnessRelationship${index}`,
          requestBody: {
            required: true,
            content: { "application/json": { schema } },
          },
          responses: {
            "200": {
              description: "Synthetic soundness response",
              content: { "application/json": { schema } },
            },
          },
        },
      },
    },
  };
}

function relationshipFixture(constraint) {
  const tree = objectNode();
  let sound = {};
  let unsound;

  if (constraint.ordered) {
    const paths = constraint.ordered.paths;
    const numeric = paths.every(isNumericPath);
    paths.forEach((path, index) => {
      declarePath(tree, path, numeric ? numberSchema() : dateTimeSchema(), true);
      setPath(sound, path, numeric ? index + 1 : instant(index));
    });
    unsound = structuredClone(sound);
    setPath(unsound, paths[0], numeric ? paths.length + 1 : instant(paths.length + 1));
    setPath(unsound, paths[1], numeric ? 1 : instant(0));
  } else if (constraint.bounded) {
    const { path, minimum, maximum, "exclusive-minimum": exclusiveMinimum, "exclusive-maximum": exclusiveMaximum } = constraint.bounded;
    const lower = minimum ?? exclusiveMinimum;
    const upper = maximum ?? exclusiveMaximum;
    declarePath(tree, path, numberSchema(), true);
    if (lower) {
      declarePath(tree, lower.path, numberSchema(), true);
      setPath(sound, lower.path, 2);
    }
    if (upper) {
      declarePath(tree, upper.path, numberSchema(), true);
      setPath(sound, upper.path, 8);
    }
    setSelectorValues(sound, path, [5, 6]);
    unsound = structuredClone(sound);
    const invalid = lower ? (exclusiveMinimum ? 2 : 1) : (exclusiveMaximum ? 8 : 9);
    setSelectorValues(unsound, path, [invalid]);
  } else if (constraint.implies) {
    const { when, then } = constraint.implies;
    // Declare every path before assigning values. A predicate can refer to an
    // object while another consequence refers to one of that object's fields.
    applyPredicate(tree, {}, when);
    for (const consequence of then.all) applyAssertion(tree, {}, consequence);
    sound = {};
    applyPredicate(tree, sound, when);
    for (const consequence of then.all) applyAssertion(tree, sound, consequence);
    unsound = structuredClone(sound);
    violateAssertion(tree, unsound, then.all[0]);
  } else if (constraint.equal) {
    const paths = constraint.equal.paths;
    const numeric = paths.every(isNumericPath);
    const value = numeric ? 7 : paths.every(isDateTimePath) ? instant(1) : "ghs";
    paths.forEach((path) => {
      declarePath(tree, path, numeric ? numberSchema() : paths.every(isDateTimePath) ? dateTimeSchema() : stringSchema(), true);
      setPath(sound, path, value);
    });
    unsound = structuredClone(sound);
    setPath(unsound, paths[1], numeric ? value + 1 : paths.every(isDateTimePath) ? instant(2) : "usd");
  } else if (constraint.distinct) {
    const { source } = constraint.distinct;
    const numeric = isNumericPath(source);
    declarePath(tree, source, numeric ? numberSchema() : stringSchema(), true);
    setSelectorValues(sound, source, numeric ? [1, 2] : ["first", "second"]);
    unsound = structuredClone(sound);
    setSelectorValues(unsound, source, numeric ? [1, 1] : ["same", "same"]);
  } else if (constraint.set) {
    const { left, relation, right } = constraint.set;
    const arraySchema = { type: "array", items: stringSchema() };
    declarePath(tree, left, arraySchema, true);
    declarePath(tree, right, arraySchema, true);
    if (relation === "subset-of") {
      setPath(sound, left, ["a"]);
      setPath(sound, right, ["a", "b"]);
      unsound = structuredClone(sound);
      setPath(unsound, left, ["outside"]);
    } else if (relation === "superset-of") {
      setPath(sound, left, ["a", "b"]);
      setPath(sound, right, ["a"]);
      unsound = structuredClone(sound);
      setPath(unsound, left, ["outside"]);
    } else if (relation === "disjoint") {
      setPath(sound, left, ["a"]);
      setPath(sound, right, ["b"]);
      unsound = structuredClone(sound);
      setPath(unsound, left, ["b"]);
    } else {
      throw new Error(`unsupported set relation ${relation}`);
    }
  } else if (constraint.equation) {
    const { target, value } = constraint.equation;
    const sources = expressionPaths(value);
    sources.forEach((path, index) => {
      declarePath(tree, path, numberSchema(), true);
      setPath(sound, path, (index + 1) * 3);
    });
    declarePath(tree, target, numberSchema(), true);
    setPath(sound, target, evaluateExpression(value, sound));
    unsound = structuredClone(sound);
    setPath(unsound, target, readPointer(sound, target) + 1);
  } else if (constraint.aggregate) {
    const { target, operation, source, when } = constraint.aggregate;
    declarePath(tree, target, numberSchema(), true);
    declarePath(tree, source, numberSchema(), true);
    if (when) {
      applyPredicate(tree, sound, when);
      if (target.startsWith(`${when.path}/`) && typeof readPointer(sound, when.path) !== "object") {
        setPath(sound, when.path, {});
      }
    }
    setSelectorValues(sound, source, [2, 3]);
    const expected = operation === "sum" ? 5 : operation === "count" ? 2 : operation === "min" ? 2 : 3;
    setPath(sound, target, expected);
    unsound = structuredClone(sound);
    setPath(unsound, target, expected + 1);
  } else if (constraint.template) {
    const { path, value } = constraint.template;
    const placeholders = [...value.matchAll(/\{(\/[^}]+)\}/g)].map((match) => match[1]);
    placeholders.forEach((placeholder, index) => {
      declarePath(tree, placeholder, stringSchema(), true);
      setPath(sound, placeholder, `value-${index}`);
    });
    declarePath(tree, path, stringSchema(), true);
    const rendered = value.replace(/\{(\/[^}]+)\}/g, (_, pointer) => String(readPointer(sound, pointer)));
    setPath(sound, path, rendered);
    unsound = structuredClone(sound);
    setPath(unsound, path, `${rendered}-wrong`);
  } else if (constraint.lifecycle) {
    const { state, "created-at": createdAt, transitions } = constraint.lifecycle;
    const states = [...new Set(transitions.flatMap((transition) => [
      ...(Array.isArray(transition.from) ? transition.from : [transition.from]),
      transition.to,
    ]))];
    declarePath(tree, state, { type: "string", enum: states }, true);
    declarePath(tree, createdAt, dateTimeSchema(), true);
    transitions.forEach((transition) => declarePath(tree, transition.at, dateTimeSchema(), false));
    const transition = transitions[0];
    setPath(sound, state, transition.to);
    setPath(sound, createdAt, instant(0));
    setPath(sound, transition.at, instant(1));
    unsound = structuredClone(sound);
    removePath(unsound, transition.at);
  } else {
    throw new Error(`unsupported relationship fixture: ${JSON.stringify(constraint)}`);
  }

  return { schema: renderNode(tree), sound, unsound };
}

function applyPredicate(tree, value, predicate) {
  if (predicate.compare) {
    const { left, operator, right } = predicate.compare;
    const numeric = isNumericPath(left.path) && isNumericPath(right.path);
    declarePath(tree, left.path, numeric ? numberSchema() : dateTimeSchema(), true);
    declarePath(tree, right.path, numeric ? numberSchema() : dateTimeSchema(), true);
    const low = numeric ? 1 : instant(0);
    const high = numeric ? 2 : instant(1);
    const leftWins = operator === "greater-than" || operator === "greater-than-or-equal";
    setPath(value, left.path, leftWins ? high : low);
    setPath(value, right.path, leftWins ? low : high);
    return;
  }
  const required = predicate.state !== "absent" && predicate.state !== "null-or-absent";
  const schema = predicate.contains !== undefined
    ? { type: "array", items: schemaForValue(predicate.contains) }
    : schemaForValue(predicate.equals, predicate.state === "null");
  declarePath(tree, predicate.path, schema, required);
  if (predicate.equals !== undefined) setPath(value, predicate.path, predicate.equals);
  else if (predicate.contains !== undefined) setPath(value, predicate.path, [predicate.contains]);
  else applyState(value, predicate.path, predicate.state, sampleForPath(tree, predicate.path));
}

function applyAssertion(tree, value, assertion) {
  // Consequence fields stay optional in the projected OpenAPI schema. Their
  // presence or value must be enforced by the relationship under test, not by
  // an incidental `required` keyword that would make the unsound fixture fail
  // before Simile evaluates the implication.
  declarePath(tree, assertion.path, schemaForValue(assertion.equals, assertion.state === "null"), false);
  if (assertion.equals !== undefined) setPath(value, assertion.path, assertion.equals);
  else applyState(value, assertion.path, assertion.state, sampleForPath(tree, assertion.path));
}

function violateAssertion(tree, value, assertion) {
  if (assertion.equals !== undefined) {
    setPath(value, assertion.path, alternate(assertion.equals));
    return;
  }
  switch (assertion.state) {
    case "absent":
    case "null-or-absent":
      setPath(value, assertion.path, sampleForPath(tree, assertion.path));
      break;
    case "null":
      setPath(value, assertion.path, "non-null");
      break;
    case "present":
    case "non-null":
      removePath(value, assertion.path);
      break;
    default:
      throw new Error(`unsupported assertion state ${assertion.state}`);
  }
}

function applyState(value, path, state, sample) {
  if (state === "present" || state === "non-null") setPath(value, path, sample);
  else if (state === "null") setPath(value, path, null);
  else if (state === "absent" || state === "null-or-absent") removePath(value, path);
  else throw new Error(`unsupported predicate state ${state}`);
}

function expressionPaths(expression) {
  if (expression.literal !== undefined) return [];
  if (expression.path) return [expression.path];
  const operands = expression.add ?? expression.subtract ?? expression.multiply;
  return operands.flatMap(expressionPaths);
}

function evaluateExpression(expression, value) {
  if (expression.literal !== undefined) return expression.literal;
  if (expression.path) return readPointer(value, expression.path);
  if (expression.add) return expression.add.reduce((total, operand) => total + evaluateExpression(operand, value), 0);
  if (expression.multiply) return expression.multiply.reduce((total, operand) => total * evaluateExpression(operand, value), 1);
  return evaluateExpression(expression.subtract[0], value) - evaluateExpression(expression.subtract[1], value);
}

function objectNode() {
  return { children: new Map(), required: false, leaf: undefined, array: false };
}

function declarePath(root, pointer, leaf, required) {
  const segments = pointerSegments(pointer);
  let node = root;
  for (const segment of segments) {
    if (!node.children.has(segment)) node.children.set(segment, objectNode());
    node = node.children.get(segment);
    node.required ||= required;
    if (segment === "*") node.array = true;
  }
  node.leaf = mergeSchema(node.leaf, leaf);
}

function renderNode(node) {
  if (node.children.size === 0) return node.leaf ?? stringSchema();
  const properties = {};
  const required = [];
  for (const [name, child] of node.children) {
    if (name === "*") continue;
    const wildcard = child.children.get("*");
    properties[name] = wildcard
      ? { type: "array", minItems: 1, items: renderNode(wildcard) }
      : renderNode(child);
    if (child.required) required.push(name);
  }
  const schema = { type: "object", additionalProperties: false, properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

function sampleForPath(root, pointer) {
  let node = root;
  for (const segment of pointerSegments(pointer)) node = node.children.get(segment);
  if (node.children.size > 0) return {};
  if (node.leaf?.type === "boolean") return true;
  if (node.leaf?.type === "integer" || node.leaf?.type === "number") return 1;
  if (node.leaf?.type === "array") return [];
  if (node.leaf?.type === "object") return {};
  if (node.leaf?.format === "date-time") return instant(1);
  return "present";
}

function mergeSchema(current, incoming) {
  if (!current) return incoming;
  return { ...current, ...incoming, nullable: current.nullable || incoming.nullable || undefined };
}

function setPath(value, pointer, nextValue) {
  setSelectorValues(value, pointer, [nextValue]);
}

function setSelectorValues(value, pointer, values) {
  const segments = pointerSegments(pointer);
  if (segments.includes("*")) {
    const wildcardIndex = segments.indexOf("*");
    let current = value;
    for (let index = 0; index < wildcardIndex; index += 1) {
      const segment = segments[index];
      const nextIsWildcard = segments[index + 1] === "*";
      current[segment] ??= nextIsWildcard ? [] : {};
      current = current[segment];
    }
    while (current.length < values.length) current.push({});
    const tail = segments.slice(wildcardIndex + 1);
    if (tail.length === 0) {
      current.splice(0, current.length, ...values);
      return;
    }
    values.forEach((itemValue, itemIndex) => {
      let item = current[itemIndex];
      tail.forEach((segment, tailIndex) => {
        if (tailIndex === tail.length - 1) item[segment] = itemValue;
        else {
          item[segment] ??= {};
          item = item[segment];
        }
      });
    });
    return;
  }
  let current = value;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) current[segment] = values[0];
    else {
      current[segment] ??= {};
      current = current[segment];
    }
  });
}

function removePath(value, pointer) {
  const segments = pointerSegments(pointer);
  let current = value;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (segment === "*") {
      current = current[0];
    } else if (current?.[segment] === undefined) {
      return;
    } else {
      current = current[segment];
    }
  }
  if (current && typeof current === "object") delete current[segments.at(-1)];
}

function readPointer(value, pointer) {
  let current = value;
  for (const segment of pointerSegments(pointer)) current = segment === "*" ? current[0] : current[segment];
  return current;
}

function pointerSegments(pointer) {
  assert.ok(pointer.startsWith("/"), `not a JSON Pointer: ${pointer}`);
  return pointer.slice(1).split("/").map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function schemaForValue(value, nullable = false) {
  const schema = value === undefined ? stringSchema() : value === null ? stringSchema() :
    typeof value === "boolean" ? { type: "boolean" } :
    typeof value === "number" ? numberSchema() : stringSchema();
  if (nullable) schema.nullable = true;
  return schema;
}

function numberSchema() {
  return { type: "integer" };
}

function stringSchema() {
  return { type: "string" };
}

function dateTimeSchema() {
  return { type: "string", format: "date-time" };
}

function isNumericPath(pointer) {
  const name = pointerSegments(pointer).at(-1);
  return ["value", "version", "active_version", "minimum", "maximum", "min", "max"].includes(name);
}

function isDateTimePath(pointer) {
  const name = pointerSegments(pointer).at(-1);
  return name.endsWith("_at") || name === "created";
}

function instant(index) {
  return new Date(Date.UTC(2020 + index, 0, 1)).toISOString();
}

function alternate(value) {
  if (typeof value === "boolean") return !value;
  if (typeof value === "number") return value + 1;
  if (value === null) return "non-null";
  return `${value}-different`;
}

function readAt(value, path) {
  return path.reduce((current, segment) => current?.[segment], value);
}

function label(location) {
  return location.slice(2).join(".");
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
