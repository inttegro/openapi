import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

const SMITHY_VERSION = "1.75.0";
const SMITHY_TRANSLATE_VERSION = "0.7.10";
const NAMESPACE = "com.inttegro.api";
const SERVICE_NAME = "Inttegro";
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  "anyOf",
  "discriminator",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "not",
  "nullable",
]);
const SHAPE_DECLARATION =
  /^(?:bigDecimal|bigInteger|blob|boolean|byte|document|double|enum|float|integer|intEnum|list|long|map|operation|resource|service|short|string|structure|timestamp|union)\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm;

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const openApiPath = join(rootDir, "commerce.yml");
const smithyDir = join(rootDir, "smithy");
const smithyIdlPath = join(smithyDir, "commerce.smithy");
const smithyAstPath = join(rootDir, "commerce.smithy.json");
const check = process.argv.includes("--check");
const tempDir = mkdtempSync(join(tmpdir(), "inttegro-smithy-"));

try {
  const openApiBytes = readFileSync(openApiPath);
  const sourceDigest = createHash("sha256").update(openApiBytes).digest("hex");
  const sourceDocument = parse(openApiBytes.toString("utf8"));
  const projectionDocument = structuredClone(sourceDocument);

  prepareProjectionInput(projectionDocument, sourceDocument, sourceDigest);

  const translator = commandFromEnvironment(
    "SMITHY_TRANSLATE_COMMAND",
    "smithytranslate",
  );
  const smithy = commandFromEnvironment("SMITHY_COMMAND", "smithy");
  assertToolVersion(
    translator,
    ["version"],
    SMITHY_TRANSLATE_VERSION,
    "smithytranslate",
  );
  assertToolVersion(smithy, ["--version"], SMITHY_VERSION, "Smithy CLI");

  const translatorInputDir = join(tempDir, "input");
  const translatorOutputDir = join(tempDir, "translated");
  mkdirSync(translatorInputDir, { recursive: true });
  mkdirSync(translatorOutputDir, { recursive: true });
  const translatorInputPath = join(translatorInputDir, "commerce.yml");
  writeFileSync(
    translatorInputPath,
    stringify(projectionDocument, { lineWidth: 0 }),
  );

  const translation = runCommand(
    translator,
    [
      "openapi-to-smithy",
      "--input",
      translatorInputPath,
      "--verbose-names",
      "--force",
      translatorOutputDir,
    ],
    "translate OpenAPI to Smithy",
  );
  validateTranslatorDiagnostics(`${translation.stdout}\n${translation.stderr}`);

  const translatedPath = join(translatorOutputDir, "commerce.smithy");
  if (!existsSync(translatedPath)) {
    throw new Error("smithytranslate did not produce commerce.smithy");
  }

  let idl = readFileSync(translatedPath, "utf8");
  idl = projectSmithy(idl, sourceDocument, sourceDigest);
  validateProjectedIdl(idl, sourceDocument, sourceDigest);

  const buildDir = join(tempDir, "build-input");
  mkdirSync(buildDir, { recursive: true });
  const buildIdlPath = join(buildDir, "commerce.smithy");
  const buildConfigPath = join(buildDir, "smithy-build.json");
  writeFileSync(buildIdlPath, idl);
  writeFileSync(
    buildConfigPath,
    `${JSON.stringify(buildConfig(buildIdlPath, join(buildDir, "build")), null, 2)}\n`,
  );

  runCommand(
    smithy,
    ["build", "--quiet", "--config", buildConfigPath],
    "compile the Smithy projection",
  );
  const compiledModelPath = join(
    buildDir,
    "build",
    "source",
    "model",
    "model.json",
  );
  if (!existsSync(compiledModelPath)) {
    throw new Error("Smithy CLI did not produce the source model JSON AST");
  }

  const ast = JSON.parse(readFileSync(compiledModelPath, "utf8"));
  validateCompiledModel(ast, sourceDocument, sourceDigest);

  if (check) {
    compareGeneratedFile(smithyIdlPath, Buffer.from(idl));
    compareGeneratedFile(smithyAstPath, readFileSync(compiledModelPath));
    console.log(
      `Smithy IDL and JSON AST are current for ${operationIds(sourceDocument).length} operations.`,
    );
  } else {
    mkdirSync(smithyDir, { recursive: true });
    writeFileSync(smithyIdlPath, idl);
    cpSync(compiledModelPath, smithyAstPath);
    console.log(
      `Generated smithy/commerce.smithy and commerce.smithy.json for ${operationIds(sourceDocument).length} operations.`,
    );
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function prepareProjectionInput(document, source, sourceDigest) {
  document.info ??= {};
  document.info["x-inttegro-source-openapi-sha256"] = sourceDigest;
  document.info["x-inttegro-smithy-projection"] = {
    namespace: NAMESPACE,
    service: SERVICE_NAME,
    smithy: SMITHY_VERSION,
    smithytranslate: SMITHY_TRANSLATE_VERSION,
  };

  let pureReferenceCount = 0;
  for (const [name, schema] of Object.entries(
    document.components?.schemas ?? {},
  )) {
    if (isPlainObject(schema) && Object.keys(schema).length === 1 && schema.$ref) {
      document.components.schemas[name] = { allOf: [{ $ref: schema.$ref }] };
      pureReferenceCount += 1;
    }
  }
  if (pureReferenceCount !== 1) {
    throw new Error(
      `Expected one top-level pure-reference schema, found ${pureReferenceCount}`,
    );
  }

  let untypedDefaultCount = 0;
  walkObjects(document, (value, path) => {
    if (
      path.at(-2) === "properties" &&
      path.at(-1) === "default" &&
      isPlainObject(value) &&
      Object.keys(value).every((key) => key === "description")
    ) {
      // Why: these four fields intentionally accept arbitrary JSON. Giving the
      // converter an empty object schema maps them to Smithy Document instead of
      // crashing while preserving their public, unconstrained value semantics.
      value.type = "object";
      untypedDefaultCount += 1;
    }
  });
  if (untypedDefaultCount !== 4) {
    throw new Error(
      `Expected four unconstrained default-value fields, found ${untypedDefaultCount}`,
    );
  }

  for (const [name, schema] of Object.entries(
    document.components?.schemas ?? {},
  )) {
    const sourceSchema = source.components.schemas[name];
    if (containsUnsupportedSchemaKeyword(sourceSchema)) {
      // Why: Smithy has no native equivalent for every OpenAPI composition and
      // nullability rule. Retaining the exact source fragment prevents consumers
      // from mistaking a necessarily looser Smithy projection for lost contract.
      schema["x-inttegro-openapi-source-schema"] = sourceSchema;
    }
  }
}

function projectSmithy(input, openApi, sourceDigest) {
  let idl = input.replace("namespace commerce", `namespace ${NAMESPACE}`);
  idl = idl.replace("use alloy#discriminated\n", "");
  idl = renameComponentShapes(idl, Object.keys(openApi.components.schemas));
  idl = renameConverterPrefixedShapes(idl);
  idl = renameRemainingCaseConflicts(idl);
  idl = replaceToken(idl, "CommerceService", SERVICE_NAME);

  const version = openApi.info?.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("OpenAPI info.version is required for the Smithy service");
  }
  idl = replaceOnce(
    idl,
    `service ${SERVICE_NAME} {\n    operations: [`,
    `service ${SERVICE_NAME} {\n    version: ${JSON.stringify(version)}\n    operations: [`,
    "add the Smithy service version",
  );

  const authOverrides = collectAuthOverrides(openApi);
  for (const operationId of authOverrides.unauthenticated) {
    idl = addOperationTrait(idl, operationId, "@auth([])");
  }
  for (const operationId of authOverrides.optional) {
    idl = removeOperationAuthTrait(idl, operationId);
    idl = addOperationTrait(idl, operationId, "@optionalAuth");
  }

  for (const operation of operations(openApi)) {
    if (operation.method === "get") {
      idl = addOperationTrait(idl, operation.id, "@readonly");
    }
  }

  // Why: smithytranslate emits Alloy discriminated unions whose target
  // structures still contain the discriminator member. Alloy rejects that
  // combination. Untagged unions preserve the one-of alternatives, while the
  // exact OpenAPI discriminator remains in x-inttegro-openapi-source-schema.
  idl = idl.replace(/^@discriminated\([^\n]+\)$/gm, "@untagged");

  idl = mergeAlternateSuccessResponses(idl, openApi);
  idl = appendStatusCodeEnums(idl);
  idl = canonicalizeOpenApiExtensions(idl);

  const header = [
    "// Code generated by scripts/generate-smithy.mjs from commerce.yml; DO NOT EDIT.",
    `// OpenAPI SHA-256: ${sourceDigest}`,
    "// Why: commerce.yml remains authoritative while this portable Smithy projection serves Smithy-native consumers.",
    "",
  ].join("\n");
  // Why: converter-generated documentation inherits YAML block padding. Strip
  // only end-of-line whitespace so the public artifact stays diff-clean.
  const normalized = idl
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
  return `${header}${normalized.trimEnd()}\n`;
}

function renameComponentShapes(idl, componentNames) {
  const oldNames = new Set(
    componentNames.map((name) => `componentsschemas${sanitizeShapeName(name)}`),
  );
  const declarations = declaredShapeNames(idl);
  for (const oldName of oldNames) {
    if (!declarations.includes(oldName)) {
      throw new Error(`smithytranslate did not emit component shape ${oldName}`);
    }
  }

  const occupied = new Set(
    declarations
      .filter((name) => !oldNames.has(name))
      .map((name) => name.toLowerCase()),
  );
  const renames = new Map();
  for (const componentName of componentNames) {
    const oldName = `componentsschemas${sanitizeShapeName(componentName)}`;
    const base = sanitizeShapeName(componentName);
    let desired = base;
    let suffix = 2;
    if (occupied.has(desired.toLowerCase())) {
      desired = `${base}Model`;
    }
    while (occupied.has(desired.toLowerCase())) {
      desired = `${base}Model${suffix}`;
      suffix += 1;
    }
    occupied.add(desired.toLowerCase());
    renames.set(oldName, desired);
  }
  return replaceTokens(idl, renames);
}

function renameRemainingCaseConflicts(idl) {
  let result = idl;
  while (true) {
    const declarations = declaredShapeNames(result);
    const seen = new Set();
    const conflict = declarations.find((name) => {
      const folded = name.toLowerCase();
      if (seen.has(folded)) {
        return true;
      }
      seen.add(folded);
      return false;
    });
    if (!conflict) {
      return result;
    }

    const occupied = new Set(declarations.map((name) => name.toLowerCase()));
    let replacement = `${conflict}CaseVariant`;
    let suffix = 2;
    while (occupied.has(replacement.toLowerCase())) {
      replacement = `${conflict}CaseVariant${suffix}`;
      suffix += 1;
    }
    result = replaceToken(result, conflict, replacement);
  }
}

function renameConverterPrefixedShapes(idl) {
  const prefix = "componentsschemas";
  const declarations = declaredShapeNames(idl);
  const prefixed = declarations.filter((name) => name.startsWith(prefix));
  const occupied = new Set(
    declarations
      .filter((name) => !name.startsWith(prefix))
      .map((name) => name.toLowerCase()),
  );
  const renames = new Map();
  for (const oldName of prefixed) {
    const base = sanitizeShapeName(oldName.slice(prefix.length) || "Schema");
    let desired = base;
    let suffix = 2;
    if (occupied.has(desired.toLowerCase())) {
      desired = `${base}Schema`;
    }
    while (occupied.has(desired.toLowerCase())) {
      desired = `${base}Schema${suffix}`;
      suffix += 1;
    }
    occupied.add(desired.toLowerCase());
    renames.set(oldName, desired);
  }
  return replaceTokens(idl, renames);
}

function mergeAlternateSuccessResponses(idl, openApi) {
  const expected = new Map([
    ["openFileLink", ["200", "302"]],
    ["sendOrderInvoice", ["200", "207"]],
    ["sendOrderReceipt", ["200", "207"]],
    ["streamFileContents", ["200", "303"]],
  ]);
  const actual = new Map();
  for (const operation of operations(openApi)) {
    const statuses = Object.keys(operation.value.responses ?? {}).filter((status) =>
      /^[23]\d\d$/.test(status),
    );
    if (statuses.length > 1) {
      actual.set(operation.id, statuses);
    }
  }
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(
      `Alternate success response set changed: ${JSON.stringify(Object.fromEntries(actual))}`,
    );
  }

  idl = removeOperationError(idl, "openFileLink", "openFileLink302");
  idl = removeOperationError(
    idl,
    "streamFileContents",
    "streamFileContents303",
  );

  idl = addResponseStatusMember(
    idl,
    "openFileLink200",
    "OpenFileLinkStatusCode",
    true,
    undefined,
    responseVariants(openApi, "openFileLink"),
  );
  idl = addResponseStatusMember(
    idl,
    "streamFileContents200",
    "StreamFileContentsStatusCode",
    true,
    '@httpHeader("Location")\n    Location: String',
    responseVariants(openApi, "streamFileContents"),
  );
  idl = addResponseStatusMember(
    idl,
    "sendOrderInvoice200",
    "OrderDocumentDeliveryStatusCode",
    false,
    undefined,
    responseVariants(openApi, "sendOrderInvoice"),
  );
  idl = addResponseStatusMember(
    idl,
    "sendOrderReceipt200",
    "OrderDocumentDeliveryStatusCode",
    false,
    undefined,
    responseVariants(openApi, "sendOrderReceipt"),
  );

  idl = removeTopLevelShape(idl, "structure", "openFileLink302");
  idl = removeTopLevelShape(idl, "structure", "streamFileContents303");
  return idl;
}

function addResponseStatusMember(
  idl,
  shapeName,
  statusType,
  bodyOptional,
  extraMember,
  variants,
) {
  const pattern = new RegExp(`^structure ${shapeName} \\{\\n([\\s\\S]*?)^\\}\\n`, "m");
  const match = idl.match(pattern);
  if (!match) {
    throw new Error(`Unable to find output structure ${shapeName}`);
  }
  let members = match[1];
  if (bodyOptional) {
    members = replaceOnce(
      members,
      "    @httpPayload\n    @required\n",
      "    @httpPayload\n",
      `make ${shapeName} payload conditional on the response status`,
    );
  }
  if (extraMember && !members.includes(extraMember)) {
    members = `    ${extraMember}\n${members}`;
  }
  members = `    @httpResponseCode\n    @required\n    statusCode: ${statusType}\n${members}`;
  const trait = openApiExtensionsTrait({
    "x-inttegro-http-success-responses": variants,
  });
  return idl.replace(
    pattern,
    `${trait}\nstructure ${shapeName} {\n${members}}\n`,
  );
}

function appendStatusCodeEnums(idl) {
  return `${idl.trimEnd()}\n\nintEnum OpenFileLinkStatusCode {\n    OK = 200\n    FOUND = 302\n}\n\nintEnum StreamFileContentsStatusCode {\n    OK = 200\n    SEE_OTHER = 303\n}\n\nintEnum OrderDocumentDeliveryStatusCode {\n    OK = 200\n    PARTIAL_SUCCESS = 207\n}\n`;
}

function addOperationTrait(idl, operationId, trait) {
  const marker = `operation ${operationId} {`;
  const index = idl.indexOf(marker);
  if (index === -1) {
    throw new Error(`Unable to find operation ${operationId}`);
  }
  const before = idl.slice(0, index);
  if (before.endsWith(`${trait}\n`)) {
    return idl;
  }
  return `${before}${trait}\n${idl.slice(index)}`;
}

function removeOperationAuthTrait(idl, operationId) {
  const marker = `operation ${operationId} {`;
  const operationIndex = idl.indexOf(marker);
  if (operationIndex === -1) {
    throw new Error(`Unable to find operation ${operationId}`);
  }
  const blockStart = idl.lastIndexOf("\n\n", operationIndex) + 2;
  const prefix = idl.slice(blockStart, operationIndex);
  const cleaned = prefix.replace(
    /@auth\(\[\s*httpBearerAuth\s*\]\)\n/,
    "",
  );
  if (cleaned === prefix) {
    throw new Error(`Expected inherited bearer auth override on ${operationId}`);
  }
  return `${idl.slice(0, blockStart)}${cleaned}${idl.slice(operationIndex)}`;
}

function removeOperationError(idl, operationId, errorShape) {
  const pattern = new RegExp(
    `(operation ${operationId} \\{[\\s\\S]*?errors: \\[\\n)([\\s\\S]*?)(    \\]\\n\\})`,
  );
  const match = idl.match(pattern);
  if (!match) {
    throw new Error(`Unable to find error list for ${operationId}`);
  }
  const nextErrors = match[2].replace(`        ${errorShape}\n`, "");
  if (nextErrors === match[2]) {
    throw new Error(`${operationId} did not contain generated error ${errorShape}`);
  }
  return idl.replace(pattern, `${match[1]}${nextErrors}${match[3]}`);
}

function removeTopLevelShape(idl, kind, name) {
  const pattern = new RegExp(`^${kind} ${name} \\{\\n[\\s\\S]*?^\\}\\n\\n?`, "m");
  if (!pattern.test(idl)) {
    throw new Error(`Unable to remove ${kind} ${name}`);
  }
  return idl.replace(pattern, "");
}

function responseVariants(openApi, operationId) {
  const operation = operations(openApi).find((candidate) => candidate.id === operationId);
  if (!operation) {
    throw new Error(`Missing OpenAPI operation ${operationId}`);
  }
  return Object.fromEntries(
    Object.entries(operation.value.responses).filter(([status]) =>
      /^[23]\d\d$/.test(status),
    ),
  );
}

function openApiExtensionsTrait(extensions) {
  const entries = Object.entries(extensions).map(([name, value]) => {
    const json = JSON.stringify(value, null, 2)
      .split("\n")
      .map((line, index) => (index === 0 ? line : `    ${line}`))
      .join("\n");
    return `    ${JSON.stringify(name)}: ${json}`;
  });
  return `@openapiExtensions(\n${entries.join("\n")}\n)`;
}

function canonicalizeOpenApiExtensions(idl) {
  const marker = "@openapiExtensions(";
  let cursor = 0;
  let result = "";
  while (true) {
    const start = idl.indexOf(marker, cursor);
    if (start === -1) {
      return `${result}${idl.slice(cursor)}`;
    }
    result += idl.slice(cursor, start);
    const bodyStart = start + marker.length;
    const end = findBalancedParenthesis(idl, bodyStart);
    const tokens = tokenizeSmithyNode(idl.slice(bodyStart, end));
    const entries = parseSmithyNodeEntries(tokens);
    result += `@openapiExtensions(\n${formatSmithyNodeEntries(entries, 1)}\n)`;
    cursor = end + 1;
  }
}

function findBalancedParenthesis(input, bodyStart) {
  let depth = 1;
  let inString = false;
  let escaped = false;
  for (let index = bodyStart; index < input.length; index += 1) {
    const character = input[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error("Unterminated @openapiExtensions trait");
}

function tokenizeSmithyNode(input) {
  const tokens = [];
  let index = 0;
  while (index < input.length) {
    const character = input[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if ('{}[]:,'.includes(character)) {
      tokens.push({ type: character, value: character });
      index += 1;
      continue;
    }
    if (character === '"') {
      let end = index + 1;
      let escaped = false;
      for (; end < input.length; end += 1) {
        const next = input[end];
        if (escaped) {
          escaped = false;
        } else if (next === "\\") {
          escaped = true;
        } else if (next === '"') {
          end += 1;
          break;
        }
      }
      if (end > input.length || input[end - 1] !== '"') {
        throw new Error("Unterminated string in @openapiExtensions");
      }
      const raw = input.slice(index, end);
      tokens.push({ type: "string", value: JSON.parse(raw) });
      index = end;
      continue;
    }
    const match = input.slice(index).match(/^[^\s{}\[\]:,]+/);
    if (!match) {
      throw new Error(
        `Unsupported @openapiExtensions token near ${JSON.stringify(input.slice(index, index + 20))}`,
      );
    }
    tokens.push({ type: "atom", value: match[0] });
    index += match[0].length;
  }
  return tokens;
}

function parseSmithyNodeEntries(tokens) {
  let index = 0;

  function parseEntries(stopToken) {
    const result = {};
    while (peek()?.type !== stopToken && peek() !== undefined) {
      const key = take();
      if (key.type !== "string" && key.type !== "atom") {
        throw new Error(`Expected Smithy node key, received ${key.type}`);
      }
      expect(":");
      result[key.value] = parseValue();
      if (peek()?.type === ",") {
        take();
      }
    }
    return result;
  }

  function parseValue() {
    const token = peek();
    if (!token) {
      throw new Error("Expected Smithy node value");
    }
    if (token.type === "{") {
      take();
      const value = parseEntries("}");
      expect("}");
      return value;
    }
    if (token.type === "[") {
      take();
      const value = [];
      while (peek()?.type !== "]") {
        value.push(parseValue());
        if (peek()?.type === ",") {
          take();
        }
      }
      expect("]");
      return value;
    }
    take();
    if (token.type === "string") {
      return token.value;
    }
    if (token.value === "true") {
      return true;
    }
    if (token.value === "false") {
      return false;
    }
    if (token.value === "null") {
      return null;
    }
    return { __smithyRaw: token.value };
  }

  function expect(type) {
    const token = take();
    if (token.type !== type) {
      throw new Error(`Expected Smithy node token ${type}, received ${token.type}`);
    }
  }

  function peek() {
    return tokens[index];
  }

  function take() {
    const token = tokens[index];
    if (!token) {
      throw new Error("Unexpected end of Smithy node tokens");
    }
    index += 1;
    return token;
  }

  const result = parseEntries();
  if (index !== tokens.length) {
    throw new Error("Unexpected trailing Smithy node tokens");
  }
  return result;
}

function formatSmithyNodeEntries(entries, depth) {
  return Object.keys(entries)
    .sort()
    .map(
      (key) =>
        `${"    ".repeat(depth)}${JSON.stringify(key)}: ${formatSmithyNode(entries[key], depth)}`,
    )
    .join(",\n");
}

function formatSmithyNode(value, depth) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    return `[\n${value
      .map(
        (child) =>
          `${"    ".repeat(depth + 1)}${formatSmithyNode(child, depth + 1)}`,
      )
      .join(",\n")}\n${"    ".repeat(depth)}]`;
  }
  if (isPlainObject(value)) {
    if (Object.keys(value).length === 1 && Object.hasOwn(value, "__smithyRaw")) {
      return value.__smithyRaw;
    }
    if (Object.keys(value).length === 0) {
      return "{}";
    }
    return `{\n${formatSmithyNodeEntries(value, depth + 1)}\n${"    ".repeat(depth)}}`;
  }
  return JSON.stringify(value);
}

function validateProjectedIdl(idl, openApi, sourceDigest) {
  if (!idl.includes(`namespace ${NAMESPACE}`)) {
    throw new Error("Generated IDL has the wrong namespace");
  }
  if (!idl.includes(`service ${SERVICE_NAME} {`)) {
    throw new Error("Generated IDL has the wrong service name");
  }
  if (!idl.includes(`OpenAPI SHA-256: ${sourceDigest}`)) {
    throw new Error("Generated IDL is missing its source digest");
  }
  if (idl.includes("componentsschemas")) {
    throw new Error("Generated IDL still contains converter component prefixes");
  }
  if (idl.includes("@discriminated(")) {
    throw new Error("Generated IDL contains uncompilable discriminated unions");
  }
  const declarations = declaredShapeNames(idl);
  const folded = declarations.map((name) => name.toLowerCase());
  if (new Set(folded).size !== folded.length) {
    throw new Error("Generated IDL contains case-insensitive shape conflicts");
  }
  for (const id of operationIds(openApi)) {
    if (!idl.includes(`operation ${id} {`)) {
      throw new Error(`Generated IDL is missing operation ${id}`);
    }
  }
}

function validateCompiledModel(ast, openApi, sourceDigest) {
  if (ast.smithy !== "2.0") {
    throw new Error(`Expected Smithy 2.0 JSON AST, received ${ast.smithy}`);
  }
  const shapes = ast.shapes ?? {};
  const operationShapes = Object.entries(shapes).filter(
    ([name, shape]) => name.startsWith(`${NAMESPACE}#`) && shape.type === "operation",
  );
  const expectedIds = operationIds(openApi).sort();
  const actualIds = operationShapes
    .map(([name]) => name.slice(name.indexOf("#") + 1))
    .sort();
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error("Compiled Smithy operations do not match OpenAPI operationIds");
  }

  const service = shapes[`${NAMESPACE}#${SERVICE_NAME}`];
  if (!service || service.type !== "service") {
    throw new Error("Compiled Smithy model is missing the Inttegro service");
  }
  if (service.version !== openApi.info.version) {
    throw new Error("Compiled Smithy service version does not match OpenAPI");
  }
  if ((service.operations ?? []).length !== expectedIds.length) {
    throw new Error("Compiled Smithy service does not bind every operation");
  }
  const extensions = service.traits?.["alloy.openapi#openapiExtensions"] ?? {};
  if (extensions["x-inttegro-source-openapi-sha256"] !== sourceDigest) {
    throw new Error("Compiled Smithy service is missing the OpenAPI source digest");
  }

  const auth = collectAuthOverrides(openApi);
  for (const id of auth.unauthenticated) {
    const trait = shapes[`${NAMESPACE}#${id}`]?.traits?.["smithy.api#auth"];
    if (!Array.isArray(trait) || trait.length !== 0) {
      throw new Error(`${id} must compile with authentication disabled`);
    }
  }
  for (const id of auth.optional) {
    if (!shapes[`${NAMESPACE}#${id}`]?.traits?.["smithy.api#optionalAuth"]) {
      throw new Error(`${id} must compile with optional authentication`);
    }
  }
  for (const operation of operations(openApi).filter(
    (candidate) => candidate.method === "get",
  )) {
    if (!shapes[`${NAMESPACE}#${operation.id}`]?.traits?.["smithy.api#readonly"]) {
      throw new Error(`${operation.id} must compile as readonly`);
    }
  }

  validateSimileConstraints(shapes, openApi);
  validateDirectPatterns(shapes, openApi);
  validateAlternateStatuses(shapes);
}

function validateSimileConstraints(shapes, openApi) {
  const expected = collectExtensionValues(openApi, "x-simile-constraints");
  const actual = [];
  for (const shape of Object.values(shapes)) {
    const value =
      shape.traits?.["alloy.openapi#openapiExtensions"]?.[
        "x-simile-constraints"
      ];
    if (value !== undefined) {
      actual.push(value);
    }
  }
  const expectedCounts = multiset(expected);
  const actualCounts = multiset(actual);
  for (const [constraint, count] of expectedCounts) {
    if ((actualCounts.get(constraint) ?? 0) < count) {
      throw new Error("A Simile constraint was lost in the Smithy projection");
    }
  }
}

function validateDirectPatterns(shapes, openApi) {
  for (const [name, schema] of Object.entries(openApi.components.schemas)) {
    if (typeof schema.pattern !== "string") {
      continue;
    }
    const shape = findComponentShape(shapes, name);
    const pattern = shape?.traits?.["smithy.api#pattern"];
    if (pattern !== schema.pattern) {
      throw new Error(`Pattern for component ${name} was lost in Smithy`);
    }
  }
}

function validateAlternateStatuses(shapes) {
  const expected = new Map([
    ["OpenFileLinkStatusCode", [200, 302]],
    ["StreamFileContentsStatusCode", [200, 303]],
    ["OrderDocumentDeliveryStatusCode", [200, 207]],
  ]);
  for (const [name, values] of expected) {
    const shape = shapes[`${NAMESPACE}#${name}`];
    const actual = Object.values(shape?.members ?? {}).map(
      (member) => member.traits?.["smithy.api#enumValue"],
    );
    if (JSON.stringify(actual) !== JSON.stringify(values)) {
      throw new Error(`Smithy status enum ${name} is incomplete`);
    }
  }
}

function findComponentShape(shapes, componentName) {
  const direct = shapes[`${NAMESPACE}#${sanitizeShapeName(componentName)}`];
  if (direct) {
    return direct;
  }
  return Object.entries(shapes).find(
    ([name]) =>
      name.startsWith(`${NAMESPACE}#${sanitizeShapeName(componentName)}Model`) &&
      !name.includes("$") ,
  )?.[1];
}

function collectAuthOverrides(openApi) {
  const unauthenticated = [];
  const optional = [];
  for (const operation of operations(openApi)) {
    const security = operation.value.security;
    if (security === undefined) {
      continue;
    }
    if (Array.isArray(security) && security.length === 0) {
      unauthenticated.push(operation.id);
      continue;
    }
    if (
      Array.isArray(security) &&
      security.some((requirement) => isPlainObject(requirement) && Object.keys(requirement).length === 0) &&
      security.some((requirement) => Object.hasOwn(requirement, "bearerAuth"))
    ) {
      optional.push(operation.id);
      continue;
    }
    throw new Error(
      `Unsupported operation-level OpenAPI security on ${operation.id}: ${JSON.stringify(security)}`,
    );
  }
  return { unauthenticated, optional };
}

function operations(openApi) {
  const result = [];
  const methods = new Set([
    "delete",
    "get",
    "head",
    "options",
    "patch",
    "post",
    "put",
    "trace",
  ]);
  for (const [path, item] of Object.entries(openApi.paths ?? {})) {
    for (const [method, operation] of Object.entries(item ?? {})) {
      if (!methods.has(method) || !operation?.operationId) {
        continue;
      }
      result.push({ id: operation.operationId, method, path, value: operation });
    }
  }
  return result;
}

function operationIds(openApi) {
  return operations(openApi).map((operation) => operation.id);
}

function containsUnsupportedSchemaKeyword(value) {
  if (Array.isArray(value)) {
    return value.some(containsUnsupportedSchemaKeyword);
  }
  if (!isPlainObject(value)) {
    return false;
  }
  return Object.entries(value).some(
    ([key, child]) =>
      UNSUPPORTED_SCHEMA_KEYWORDS.has(key) ||
      containsUnsupportedSchemaKeyword(child),
  );
}

function walkObjects(value, visit, path = []) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => walkObjects(child, visit, [...path, index]));
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  visit(value, path);
  for (const [key, child] of Object.entries(value)) {
    walkObjects(child, visit, [...path, key]);
  }
}

function collectExtensionValues(value, extensionName) {
  const result = [];
  walkObjects(value, (object) => {
    if (Object.hasOwn(object, extensionName)) {
      result.push(object[extensionName]);
    }
  });
  return result;
}

function declaredShapeNames(idl) {
  return [...idl.matchAll(SHAPE_DECLARATION)].map((match) => match[1]);
}

function sanitizeShapeName(name) {
  let result = String(name).replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z_]/.test(result)) {
    result = `Shape_${result}`;
  }
  return result;
}

function replaceTokens(input, replacements) {
  let result = input;
  for (const [from, to] of [...replacements.entries()].sort(
    ([left], [right]) => right.length - left.length,
  )) {
    result = replaceToken(result, from, to);
  }
  return result;
}

function replaceToken(input, from, to) {
  return input.replace(
    new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(from)}(?![A-Za-z0-9_])`, "g"),
    to,
  );
}

function replaceOnce(input, from, to, purpose) {
  const first = input.indexOf(from);
  if (first === -1) {
    throw new Error(`Unable to ${purpose}`);
  }
  if (input.indexOf(from, first + from.length) !== -1) {
    throw new Error(`Refusing ambiguous replacement to ${purpose}`);
  }
  return `${input.slice(0, first)}${to}${input.slice(first + from.length)}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildConfig(sourcePath, outputDirectory) {
  return {
    version: "1.0",
    sources: [sourcePath],
    outputDirectory,
    maven: {
      dependencies: [
        "com.disneystreaming.alloy:alloy-core:0.3.40",
        `com.disneystreaming.smithy:smithytranslate-traits:${SMITHY_TRANSLATE_VERSION}`,
      ],
    },
  };
}

function commandFromEnvironment(name, fallback) {
  if (!process.env[name]) {
    return [fallback];
  }
  let command;
  try {
    command = JSON.parse(process.env[name]);
  } catch (error) {
    throw new Error(`${name} must be a JSON array: ${error.message}`);
  }
  if (!Array.isArray(command) || command.some((part) => typeof part !== "string")) {
    throw new Error(`${name} must be a JSON array of command arguments`);
  }
  if (command.length === 0) {
    throw new Error(`${name} cannot be empty`);
  }
  return command;
}

function assertToolVersion(command, args, expected, name) {
  const result = runCommand(command, args, `read ${name} version`);
  const output = `${result.stdout}\n${result.stderr}`;
  if (!new RegExp(`(^|\\s)${escapeRegex(expected)}(\\s|$)`).test(output)) {
    throw new Error(`${name} ${expected} is required; received:\n${output.trim()}`);
  }
}

function runCommand(command, args, purpose) {
  const [executable, ...prefix] = command;
  const result = spawnSync(executable, [...prefix, ...args], {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`Unable to ${purpose}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Unable to ${purpose} (exit ${result.status}):\n${result.stdout}${result.stderr}`,
    );
  }
  return result;
}

function validateTranslatorDiagnostics(output) {
  const expectations = new Map([
    ["Unable to automatically account for exclusiveMin/Max on decimal type Double", 9],
    ["anyOf is not allowed", 2],
    ["Multiple success responses are not supported. Found status code 207 when 200 was already recorded", 2],
    ["cannot be bound as an error because it is not marked with the `error` trait", 2],
  ]);
  for (const [message, expected] of expectations) {
    const actual = output.split(message).length - 1;
    if (actual !== expected) {
      throw new Error(
        `smithytranslate diagnostic changed for ${JSON.stringify(message)}: expected ${expected}, received ${actual}`,
      );
    }
  }
  const errorLines = output
    .split("\n")
    .filter((line) => line.includes("[ERROR]"));
  if (
    errorLines.length !== 2 ||
    !errorLines.some((line) => line.includes("openFileLink302")) ||
    !errorLines.some((line) => line.includes("streamFileContents303"))
  ) {
    throw new Error(
      `Unexpected smithytranslate validation errors:\n${errorLines.join("\n")}`,
    );
  }
}

function compareGeneratedFile(path, actual) {
  if (!existsSync(path)) {
    throw new Error(`Missing generated file ${path}`);
  }
  const expected = readFileSync(path);
  if (!expected.equals(actual)) {
    const expectedLines = expected.toString("utf8").split("\n");
    const actualLines = actual.toString("utf8").split("\n");
    const line = Array.from(
      { length: Math.max(expectedLines.length, actualLines.length) },
      (_, index) => index,
    ).find((index) => expectedLines[index] !== actualLines[index]);
    const detail =
      line === undefined
        ? ""
        : ` First difference at line ${line + 1}: expected ${JSON.stringify(expectedLines[line])}, generated ${JSON.stringify(actualLines[line])}.`;
    throw new Error(
      `${path.slice(rootDir.length + 1)} is stale; run npm run smithy:bundle.${detail}`,
    );
  }
}

function multiset(values) {
  const result = new Map();
  for (const value of values) {
    const key = stableJson(value);
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
}

function stableJson(value) {
  if (value instanceof Map) {
    return stableJson(Object.fromEntries(value));
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
