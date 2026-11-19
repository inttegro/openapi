import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const HTTP_METHODS = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
]);
const SCHEMA_KEYS = new Set([
  "$ref",
  "additionalProperties",
  "allOf",
  "anyOf",
  "default",
  "deprecated",
  "discriminator",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "items",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "not",
  "nullable",
  "oneOf",
  "pattern",
  "properties",
  "readOnly",
  "required",
  "type",
  "uniqueItems",
  "writeOnly",
  "x-simile-constraints",
]);

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(rootDir, "commerce.yml");
const typescriptDir = join(rootDir, "typescript");
const internalOutputPath = join(typescriptDir, "contract-ir.d.ts");
const operationModulesDir = join(typescriptDir, "operations");
const check = process.argv.includes("--check");

const sourceBytes = readFileSync(sourcePath);
const sourceDigest = createHash("sha256").update(sourceBytes).digest("hex");
const document = parse(sourceBytes.toString("utf8"));
const schemas = document.components?.schemas ?? {};
const operations = collectOperations(document);
const constraintSites = collectConstraintSites(schemas);
const relationEntries = collectRelationEntries(operations);
const examples = collectExamples(operations);

const outputs = renderSemanticContract();
const internalOutput = renderInternalContract();
validateSemanticContract(outputs);
if (check) {
  const currentInternal = readFileSync(internalOutputPath, "utf8");
  const stale = [...outputs].filter(
    ([relativePath, expected]) =>
      readFileSync(join(typescriptDir, relativePath), "utf8") !== expected,
  );
  const expectedOperationModules = new Set(
    [...outputs.keys()]
      .filter((relativePath) => relativePath.startsWith("operations/"))
      .map((relativePath) => relativePath.slice("operations/".length)),
  );
  const actualOperationModules = new Set(
    readdirSync(operationModulesDir).filter((name) => name.endsWith(".d.ts")),
  );
  const operationModuleSetChanged =
    expectedOperationModules.size !== actualOperationModules.size ||
    [...expectedOperationModules].some((name) => !actualOperationModules.has(name));
  if (stale.length > 0 || operationModuleSetChanged || currentInternal !== internalOutput) {
    throw new Error(
      "TypeScript contract artifacts are stale; run npm run typescript:bundle.",
    );
  }
  console.log(
    `TypeScript declaration contract is current for ${operations.length} operations, ` +
      `${Object.keys(schemas).length} schemas, ${constraintCount()} constraints, and ` +
      `${relationEntries.length} response relations.`,
  );
} else {
  mkdirSync(operationModulesDir, { recursive: true });
  for (const [relativePath, output] of outputs) {
    const outputPath = join(typescriptDir, relativePath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, output);
  }
  const expectedOperationModules = new Set(
    [...outputs.keys()]
      .filter((relativePath) => relativePath.startsWith("operations/"))
      .map((relativePath) => relativePath.slice("operations/".length)),
  );
  for (const name of readdirSync(operationModulesDir)) {
    // Why: stale generated operation modules would remain importable after an
    // API tag is renamed and could silently expose operations twice.
    if (name.endsWith(".d.ts") && !expectedOperationModules.has(name)) {
      unlinkSync(join(operationModulesDir, name));
    }
  }
  writeFileSync(internalOutputPath, internalOutput);
  console.log(
    `Generated typescript/commerce.d.ts for ${operations.length} operations, ` +
      `${Object.keys(schemas).length} schemas, ${constraintCount()} constraints, and ` +
      `${relationEntries.length} response relations.`,
  );
}

function validateSemanticContract(outputs) {
  const value = [...outputs.values()].join("\n");
  // Why: consumers must be able to treat the declarations as the contract itself; embedding the
  // generator's source format or digest would make the supposedly standalone frontend depend on it.
  if (/openapi/i.test(value) || value.includes("SourceOpenApiSha256")) {
    throw new Error("Public TypeScript contract leaked source-format identity");
  }

  // Keep the public declaration contract semantic. These tokens identify the
  // mechanical OpenAPI AST projection that belongs only in contract-ir.d.ts.
  for (const forbidden of [
    'readonly "$ref":',
    'readonly "properties":',
    'readonly "type": "object"',
    'readonly "x-simile-constraints":',
  ]) {
    if (value.includes(forbidden)) {
      throw new Error(
        `Public TypeScript contract leaked OpenAPI representation detail: ${forbidden}`,
      );
    }
  }

  for (const required of [
    "export interface Operations",
    "export interface SchemaSoundness",
    "export type OperationResult<",
    "export type SoundResponse<",
  ]) {
    if (!value.includes(required)) {
      throw new Error(`Public TypeScript contract omitted semantic surface: ${required}`);
    }
  }
}

function renderSemanticContract() {
  const combined = renderSemanticContractCombined();
  const outputs = new Map();

  outputs.set(
    "commerce.d.ts",
    renderSemanticModule([
      "// Public entrypoint. Consumer imports remain stable as the contract grows.",
      'export * from "./core";',
      'export * from "./models";',
      'export * from "./input";',
      'export * from "./output";',
      'export * from "./soundness";',
      'export * from "./operations";',
      'export * from "./examples";',
    ]),
  );

  outputs.set(
    "core.d.ts",
    renderSemanticModule(
      sliceSemanticSection(
        combined,
        "export type CollectionVersion",
        "/** Public payload models.",
      ),
    ),
  );
  outputs.set(
    "models.d.ts",
    renderSemanticModule([
      'import type { Binary, Closed, DateTime, EmailAddress, Uri } from "./core";',
      "",
      ...sliceSemanticSection(
        combined,
        "/** Public payload models.",
        "/** Cross-field business invariants",
      ),
    ]),
  );
  outputs.set(
    "soundness.d.ts",
    renderSemanticModule([
      `import type { ${[
        "Add",
        "Aggregate",
        "Bounded",
        "CompareAt",
        "ContainsAt",
        "DistinctValues",
        "EqualFields",
        "EqualsAt",
        "Equation",
        "Field",
        "Implies",
        "Lifecycle",
        "Literal",
        "Multiply",
        "Ordered",
        "Select",
        "SetRelationship",
        "StateAt",
        "Subtract",
        "Template",
      ].join(", ")} } from "./core";`,
      `import type { ${Object.keys(constraintSites).sort().join(", ")} } from "./models";`,
      "",
      ...sliceSemanticSection(
        combined,
        "/** Cross-field business invariants",
        "/** Request-direction models",
      ),
    ]),
  );
  outputs.set(
    "input.d.ts",
    renderSemanticModule([
      'import type { Binary, Closed, DateTime, EmailAddress, Uri } from "./core";',
      "",
      ...sliceSemanticSection(
        combined,
        "/** Request-direction models",
        "/** Response-direction models",
      ),
    ]),
  );
  outputs.set(
    "output.d.ts",
    renderSemanticModule([
      'import type { Binary, Closed, DateTime, EmailAddress, Uri } from "./core";',
      "",
      ...sliceSemanticSection(
        combined,
        "/** Response-direction models",
        "/** HTTP operations expressed",
      ),
    ]),
  );

  const operationGroups = groupSemanticOperations();
  for (const group of operationGroups) {
    const groupLines = [
      'import type { Binary, Closed, DateTime, EmailAddress, Uri } from "../core";',
      'import type { Input } from "../input";',
      'import type { Output } from "../output";',
      "",
      `/** HTTP operations in the ${group.label} contract area. */`,
      `export interface ${group.interfaceName} {`,
    ];
    for (const operation of group.operations) {
      groupLines.push(...renderSemanticOperation(operation));
    }
    groupLines.push("}", "");
    groupLines.push(
      ...renderResponseRelationsInterface(
        group.relationInterfaceName,
        groupResponseRelations(
          new Set(group.operations.map((operation) => operation.operationId)),
        ),
      ),
    );
    outputs.set(`operations/${group.slug}.d.ts`, renderSemanticModule(groupLines));
  }

  outputs.set(
    "operations.d.ts",
    renderSemanticModule([
      'import type { RelationHolds } from "./proof-kernel";',
      ...operationGroups.map(
        (group) =>
          `import type { ${group.interfaceName}, ${group.relationInterfaceName} } from "./operations/${group.slug}";`,
      ),
      "",
      "/** Complete public operation registry assembled from resource modules. */",
      `export interface Operations extends ${operationGroups.map((group) => group.interfaceName).join(", ")} {}`,
      "",
      ...sliceSemanticSection(
        combined,
        "export type OperationId",
        "/** Public request-to-response construction rules",
      ),
      "/** Public request-to-response construction rules, composed from resource modules. */",
      `export interface ResponseRelations extends ${operationGroups.map((group) => group.relationInterfaceName).join(", ")} {}`,
      "",
      ...sliceSemanticSection(
        combined,
        "export type ResponseRelation<",
        "/** Provider-authored examples",
      ),
    ]),
  );
  outputs.set(
    "examples.d.ts",
    renderSemanticModule(
      sliceSemanticSection(combined, "/** Provider-authored examples"),
    ),
  );

  return outputs;
}

function renderSemanticModule(lines) {
  return `${[
    "// Code generated by scripts/generate-typescript.mjs from the public Inttegro contract; DO NOT EDIT.",
    "// This is a semantic, declarations-only contract. It emits no JavaScript.",
    "",
    ...lines,
  ].join("\n")}\n`;
}

function sliceSemanticSection(combined, startMarker, endMarker) {
  const lines = combined.split("\n");
  const start = lines.findIndex((line) => line.startsWith(startMarker));
  if (start < 0) throw new Error(`Missing TypeScript section ${startMarker}`);
  let end = endMarker
    ? lines.findIndex((line, index) => index > start && line.startsWith(endMarker))
    : lines.length;
  if (endMarker && end < 0) throw new Error(`Missing TypeScript section ${endMarker}`);
  while (lines[end - 1] === "") end -= 1;
  return lines.slice(start, end);
}

function groupSemanticOperations() {
  const groups = new Map();
  for (const operation of operations) {
    const label =
      operation.operation.tags?.[0] ??
      operation.path.split("/").filter(Boolean)[0] ??
      "Other";
    const slug = String(label)
      .normalize("NFKD")
      .replaceAll(/[^A-Za-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "")
      .toLowerCase();
    if (slug.length === 0) {
      throw new Error(`Cannot derive operation module for ${operation.operationId}`);
    }
    const interfaceName = `${slug
      .split("-")
      .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
      .join("")}Operations`;
    const relationInterfaceName = interfaceName.replace(/Operations$/, "ResponseRelations");
    const existing = groups.get(slug);
    if (existing && existing.label !== label) {
      throw new Error(`Operation module collision between ${existing.label} and ${label}`);
    }
    if (existing) existing.operations.push(operation);
    else groups.set(slug, { interfaceName, label, operations: [operation], relationInterfaceName, slug });
  }
  return [...groups.values()].sort((left, right) => left.slug.localeCompare(right.slug));
}

function renderSemanticContractCombined() {
  const version = document.info?.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("OpenAPI info.version is required");
  }

  const lines = [
    "// Code generated by scripts/generate-typescript.mjs from the public Inttegro contract; DO NOT EDIT.",
    "// This is a semantic, declarations-only contract. It emits no JavaScript.",
    "",
    'import type { RelationHolds } from "./proof-kernel";',
    "",
    `export type CollectionVersion = ${JSON.stringify(version)};`,
    `export type ServiceName = ${JSON.stringify(document.info?.title ?? "Inttegro")};`,
    `export type OperationCount = ${operations.length};`,
    `export type SchemaCount = ${Object.keys(schemas).length};`,
    `export type ConstraintCount = ${constraintCount()};`,
    `export type ResponseRelationCount = ${relationEntries.length};`,
    "",
    "/** An RFC 3339 timestamp carried by the public API. */",
    "export type DateTime = string;",
    "/** An absolute URI carried by the public API. */",
    "export type Uri = string;",
    "/** An email address carried by the public API. */",
    "export type EmailAddress = string;",
    "/** Binary request or response content. */",
    "export type Binary = Uint8Array;",
    "/** A JSON object that rejects properties outside its declared public contract. */",
    "export type Closed<Value> = Value;",
    "",
    "/** A field path in a semantic relationship. `*` selects every array item. */",
    "export type FieldPath = readonly string[];",
    "export type Select<Value, Path extends FieldPath> = Path extends readonly [infer Head extends string, ...infer Tail extends string[]]",
    "  ? Head extends \"*\"",
    "    ? NonNullable<Value> extends readonly (infer Item)[] ? Select<Item, Tail> : never",
    "    : Head extends keyof NonNullable<Value> ? Select<NonNullable<Value>[Head], Tail> : never",
    "  : Value;",
    "export interface Ordered<Owner, Paths extends readonly FieldPath[]> { readonly relation: \"ordered\"; readonly owner?: Owner; readonly paths: Paths; }",
    "export interface Bounded<Owner, Path extends FieldPath, Bounds> { readonly relation: \"bounded\"; readonly owner?: Owner; readonly path: Path; readonly bounds: Bounds; }",
    "export interface EqualsAt<Owner, Path extends FieldPath, Expected> { readonly predicate: \"equals\"; readonly owner?: Owner; readonly path: Path; readonly expected: Expected; }",
    "export interface StateAt<Owner, Path extends FieldPath, State extends string> { readonly predicate: \"state\"; readonly owner?: Owner; readonly path: Path; readonly state: State; }",
    "export interface ContainsAt<Owner, Path extends FieldPath, Expected> { readonly predicate: \"contains\"; readonly owner?: Owner; readonly path: Path; readonly expected: Expected; }",
    "export interface CompareAt<Owner, Left extends FieldPath, Operator extends string, Right extends FieldPath> { readonly predicate: \"compare\"; readonly owner?: Owner; readonly left: Left; readonly operator: Operator; readonly right: Right; }",
    "export interface Implies<When, Then extends readonly unknown[]> { readonly relation: \"implies\"; readonly when: When; readonly then: Then; }",
    "export interface EqualFields<Owner, Paths extends readonly FieldPath[]> { readonly relation: \"equal\"; readonly owner?: Owner; readonly paths: Paths; }",
    "export interface DistinctValues<Owner, Source extends FieldPath> { readonly relation: \"distinct\"; readonly owner?: Owner; readonly source: Source; }",
    "export interface SetRelationship<Owner, Left extends FieldPath, Relation extends string, Right extends FieldPath> { readonly relation: Relation; readonly owner?: Owner; readonly left: Left; readonly right: Right; }",
    "export interface Field<Owner, Path extends FieldPath> { readonly expression: \"field\"; readonly owner?: Owner; readonly path: Path; }",
    "export interface Literal<Value> { readonly expression: \"literal\"; readonly value?: Value; }",
    "export interface Add<Operands extends readonly unknown[]> { readonly expression: \"add\"; readonly operands: Operands; }",
    "export interface Subtract<Left, Right> { readonly expression: \"subtract\"; readonly operands: readonly [Left, Right]; }",
    "export interface Multiply<Operands extends readonly unknown[]> { readonly expression: \"multiply\"; readonly operands: Operands; }",
    "export interface Equation<Owner, Target extends FieldPath, Expression> { readonly relation: \"equation\"; readonly owner?: Owner; readonly target: Target; readonly expression: Expression; }",
    "export interface Aggregate<Owner, Target extends FieldPath, Operation extends string, Source extends FieldPath, Guard = never> { readonly relation: \"aggregate\"; readonly owner?: Owner; readonly target: Target; readonly operation: Operation; readonly source: Source; readonly guard?: Guard; }",
    "export interface Template<Owner, Path extends FieldPath, Value extends string> { readonly relation: \"template\"; readonly owner?: Owner; readonly path: Path; readonly value: Value; }",
    "export interface Lifecycle<Owner, State extends FieldPath, CreatedAt extends FieldPath, Transitions extends readonly unknown[]> { readonly relation: \"lifecycle\"; readonly owner?: Owner; readonly state: State; readonly created_at: CreatedAt; readonly transitions: Transitions; }",
    "",
    "/** Public payload models. They are expressed directly as semantic TypeScript values. */",
  ];

  for (const [name, schema] of Object.entries(schemas).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(...renderDoc(schema.description, schema.deprecated));
    lines.push(`export type ${name} = ${renderSemanticSchema(schema, "neutral", 0)};`, "");
  }

  lines.push(
    "/** Cross-field business invariants stated over the public payload types. */",
    "export interface SchemaSoundness {",
  );
  for (const [schemaName, sites] of Object.entries(constraintSites).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const propositions = [];
    for (const [ownerPath, constraints] of Object.entries(sites).sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      const owner = ownerPath === "/" ? schemaName : `Select<${schemaName}, ${renderFieldPath(ownerPath)}>`;
      for (const constraint of constraints) propositions.push(renderSemanticConstraint(constraint, owner));
    }
    lines.push(`  readonly ${quote(schemaName)}: readonly [`, ...propositions.map((value) => `    ${value},`), "  ];");
  }
  lines.push("}", "");

  lines.push(
    "/** Request-direction models omit properties declared read-only. */",
    "export namespace Input {",
  );
  for (const [name, schema] of Object.entries(schemas).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`  export type ${name} = ${renderSemanticSchema(schema, "request", 1)};`);
  }
  lines.push("}", "", "/** Response-direction models omit properties declared write-only. */", "export namespace Output {");
  for (const [name, schema] of Object.entries(schemas).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`  export type ${name} = ${renderSemanticSchema(schema, "response", 1)};`);
  }
  lines.push("}", "", "/** HTTP operations expressed in terms of payload values and observable results. */", "export interface Operations {");
  for (const operation of operations) {
    lines.push(...renderSemanticOperation(operation));
  }
  lines.push(
    "}",
    "",
    "export type OperationId = keyof Operations;",
    "",
    "/** Public request-to-response construction rules, expressed without OpenAPI syntax. */",
    "export interface ResponseRelations {",
  );
  for (const [operationId, statuses] of Object.entries(groupResponseRelations())) {
    lines.push(`  readonly ${quote(operationId)}: ${renderType(statuses, 1)};`);
  }
  lines.push(
    "}",
    "",
    "export type ResponseRelation<",
    "  Id extends OperationId,",
    "  Status extends string,",
    "  ContentType extends string,",
    "> = Id extends keyof ResponseRelations",
    "  ? Status extends keyof ResponseRelations[Id]",
    "    ? ContentType extends keyof ResponseRelations[Id][Status]",
    "      ? ResponseRelations[Id][Status][ContentType]",
    "      : never",
    "    : never",
    "  : never;",
    "",
    "export type RequestBody<",
    "  Id extends OperationId,",
    "  ContentType extends string,",
    "> = Operations[Id][\"request\"] extends { readonly content: infer Content }",
    "  ? ContentType extends keyof Content",
    "    ? Content[ContentType]",
    "    : never",
    "  : never;",
    "",
    "export type ResponseBody<",
    "  Id extends OperationId,",
    "  Status extends string,",
    "  ContentType extends string,",
    "> = Status extends keyof Operations[Id][\"responses\"]",
    "  ? Operations[Id][\"responses\"][Status] extends { readonly content: infer Content }",
    "    ? ContentType extends keyof Content",
    "      ? Content[ContentType]",
    "      : never",
    "    : never",
    "  : never;",
    "",
    "/** Every observable response alternative for an operation, discriminated by status and media type. */",
    "export type OperationResult<Id extends OperationId> = Operations[Id][\"result\"];",
    "",
    "/**",
    " * Establish that a concrete response is reachable from a concrete request.",
    " * Operations without a declared request-to-response relation produce `never`.",
    " */",
    "export type SoundResponse<",
    "  Id extends OperationId,",
    "  Status extends string,",
    "  ContentType extends string,",
    "  Request extends RequestBody<Id, ContentType>,",
    "  Response extends ResponseBody<Id, Status, ContentType>,",
    "> = RelationHolds<",
    "  Request,",
    "  Response,",
    "  ResponseRelation<Id, Status, ContentType>",
    "> extends true",
    "  ? Response",
    "  : never;",
    "",
    "/** Provider-authored examples retained as literal witness types. */",
    "export interface OperationExamples {",
  );
  for (const [operationId, value] of Object.entries(examples).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    lines.push(`  readonly ${quote(operationId)}: ${renderType(value, 1)};`);
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function renderSemanticConstraint(constraint, owner) {
  if (constraint.ordered) {
    return `Ordered<${owner}, ${renderFieldPaths(constraint.ordered.paths)}>`;
  }
  if (constraint.bounded) {
    const { path, ...bounds } = constraint.bounded;
    const rendered = Object.entries(bounds)
      .map(([name, value]) => `readonly ${quote(name)}: ${renderSemanticBound(value, owner)}`)
      .join("; ");
    return `Bounded<${owner}, ${renderFieldPath(path)}, { ${rendered} }>`;
  }
  if (constraint.implies) {
    return `Implies<${renderSemanticPredicate(constraint.implies.when, owner)}, readonly [${constraint.implies.then.all.map((predicate) => renderSemanticPredicate(predicate, owner)).join(", ")}]>`;
  }
  if (constraint.equal) {
    return `EqualFields<${owner}, ${renderFieldPaths(constraint.equal.paths)}>`;
  }
  if (constraint.distinct) {
    return `DistinctValues<${owner}, ${renderFieldPath(constraint.distinct.source)}>`;
  }
  if (constraint.set) {
    return `SetRelationship<${owner}, ${renderFieldPath(constraint.set.left)}, ${quote(constraint.set.relation)}, ${renderFieldPath(constraint.set.right)}>`;
  }
  if (constraint.equation) {
    return `Equation<${owner}, ${renderFieldPath(constraint.equation.target)}, ${renderSemanticExpression(constraint.equation.value, owner)}>`;
  }
  if (constraint.aggregate) {
    const guard = constraint.aggregate.when
      ? renderSemanticPredicate(constraint.aggregate.when, owner)
      : "never";
    return `Aggregate<${owner}, ${renderFieldPath(constraint.aggregate.target)}, ${quote(constraint.aggregate.operation)}, ${renderFieldPath(constraint.aggregate.source)}, ${guard}>`;
  }
  if (constraint.template) {
    return `Template<${owner}, ${renderFieldPath(constraint.template.path)}, ${quote(constraint.template.value)}>`;
  }
  if (constraint.lifecycle) {
    const transitions = constraint.lifecycle.transitions.map((transition) => {
      const from = Array.isArray(transition.from)
        ? `readonly [${transition.from.map(quote).join(", ")}]`
        : quote(transition.from);
      return `{ readonly from: ${from}; readonly to: ${quote(transition.to)}; readonly at: ${renderFieldPath(transition.at)} }`;
    });
    return `Lifecycle<${owner}, ${renderFieldPath(constraint.lifecycle.state)}, ${renderFieldPath(constraint.lifecycle["created-at"])}, readonly [${transitions.join(", ")}]>`;
  }
  throw new Error(`Unsupported semantic constraint ${JSON.stringify(constraint)}`);
}

function renderSemanticPredicate(predicate, owner) {
  if (predicate.compare) {
    return `CompareAt<${owner}, ${renderFieldPath(predicate.compare.left.path)}, ${quote(predicate.compare.operator)}, ${renderFieldPath(predicate.compare.right.path)}>`;
  }
  if (predicate.equals !== undefined) {
    return `EqualsAt<${owner}, ${renderFieldPath(predicate.path)}, ${renderType(predicate.equals)}>`;
  }
  if (predicate.state !== undefined) {
    return `StateAt<${owner}, ${renderFieldPath(predicate.path)}, ${quote(predicate.state)}>`;
  }
  if (predicate.contains !== undefined) {
    return `ContainsAt<${owner}, ${renderFieldPath(predicate.path)}, ${renderType(predicate.contains)}>`;
  }
  throw new Error(`Unsupported semantic predicate ${JSON.stringify(predicate)}`);
}

function renderSemanticBound(value, owner) {
  if (isObject(value) && typeof value.path === "string") {
    return `Field<${owner}, ${renderFieldPath(value.path)}>`;
  }
  return `Literal<${renderType(value)}>`;
}

function renderSemanticExpression(expression, owner) {
  if (isObject(expression) && typeof expression.path === "string") {
    return `Field<${owner}, ${renderFieldPath(expression.path)}>`;
  }
  if (isObject(expression) && Object.hasOwn(expression, "literal")) {
    return `Literal<${renderType(expression.literal)}>`;
  }
  if (isObject(expression) && Array.isArray(expression.add)) {
    return `Add<readonly [${expression.add.map((value) => renderSemanticExpression(value, owner)).join(", ")}]>`;
  }
  if (isObject(expression) && Array.isArray(expression.subtract)) {
    return `Subtract<${renderSemanticExpression(expression.subtract[0], owner)}, ${renderSemanticExpression(expression.subtract[1], owner)}>`;
  }
  if (isObject(expression) && Array.isArray(expression.multiply)) {
    return `Multiply<readonly [${expression.multiply.map((value) => renderSemanticExpression(value, owner)).join(", ")}]>`;
  }
  throw new Error(`Unsupported semantic expression ${JSON.stringify(expression)}`);
}

function renderFieldPaths(paths) {
  return `readonly [${paths.map(renderFieldPath).join(", ")}]`;
}

function renderFieldPath(pointer) {
  if (pointer === "" || pointer === "/") return "readonly []";
  const segments = pointer
    .slice(1)
    .split("/")
    .map(decodePointer)
    .map(quote);
  return `readonly [${segments.join(", ")}]`;
}

function renderSemanticOperation({ method, path, operationId, operation, pathItem }) {
  const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]
    .map((parameter) => dereference(document, parameter));
  const groupedParameters = Object.fromEntries(
    ["path", "query", "header", "cookie"].map((location) => [
      location,
      parameters.filter((parameter) => parameter.in === location),
    ]),
  );
  const lines = [
    `  readonly ${quote(operationId)}: {`,
    `    readonly method: ${quote(method.toUpperCase())};`,
    `    readonly path: ${quote(path)};`,
    `    readonly tags: readonly [${(operation.tags ?? []).map(quote).join(", ")}];`,
    "    readonly parameters: {",
  ];
  for (const [location, values] of Object.entries(groupedParameters)) {
    lines.push(`      readonly ${location}: ${renderParameterObject(values)};`);
  }
  lines.push("    };");

  if (operation.requestBody) {
    const request = dereference(document, operation.requestBody);
    lines.push("    readonly request: {", `      readonly required: ${request.required === true};`, "      readonly content: {");
    for (const [contentType, media] of Object.entries(request.content ?? {})) {
      lines.push(`        readonly ${quote(contentType)}: ${renderSemanticSchema(media.schema ?? {}, "request", 4)};`);
    }
    lines.push("      };", "    };");
  } else {
    lines.push("    readonly request: null;");
  }

  lines.push("    readonly responses: {");
  for (const [status, responseValue] of Object.entries(operation.responses ?? {})) {
    const response = dereference(document, responseValue);
    lines.push(`      readonly ${quote(status)}: {`, "        readonly headers: {");
    for (const [name, headerValue] of Object.entries(response.headers ?? {})) {
      const header = dereference(document, headerValue);
      lines.push(`          readonly ${quote(name)}${header.required === true ? "" : "?"}: ${renderSemanticSchema(header.schema ?? {}, "response", 5)};`);
    }
    lines.push("        };", "        readonly content: {");
    for (const [contentType, media] of Object.entries(response.content ?? {})) {
      lines.push(`          readonly ${quote(contentType)}: ${renderSemanticSchema(media.schema ?? {}, "response", 5)};`);
    }
    lines.push("        };", "      };");
  }
  lines.push("    };", `    readonly result: ${renderOperationResult(operation)};`, "  };");
  return lines;
}

function renderParameterObject(parameters) {
  if (parameters.length === 0) return "Record<string, never>";
  const fields = parameters.map((parameter) =>
    `readonly ${quote(parameter.name)}${parameter.required === true ? "" : "?"}: ${renderSemanticSchema(parameter.schema ?? {}, "request", 0)};`,
  );
  return `{ ${fields.join(" ")} }`;
}

function renderOperationResult(operation) {
  const alternatives = [];
  for (const [status, responseValue] of Object.entries(operation.responses ?? {})) {
    const response = dereference(document, responseValue);
    const statusType = /^\d{3}$/.test(status) ? status : "number";
    const content = Object.entries(response.content ?? {});
    if (content.length === 0) {
      alternatives.push(`{ readonly status: ${statusType}; readonly content_type: null; readonly body: null }`);
      continue;
    }
    for (const [contentType, media] of content) {
      alternatives.push(`{ readonly status: ${statusType}; readonly content_type: ${quote(contentType)}; readonly body: ${renderSemanticSchema(media.schema ?? {}, "response", 0)} }`);
    }
  }
  return alternatives.length > 0 ? alternatives.join(" | ") : "never";
}

function renderSemanticSchema(schema, direction, indentLevel) {
  if (schema === true) return "unknown";
  if (schema === false) return "never";
  if (!isObject(schema)) return "unknown";

  const intersection = [];
  if (typeof schema.$ref === "string") {
    const name = decodePointer(schema.$ref.split("/").at(-1));
    intersection.push(direction === "neutral" ? name : `${direction === "request" ? "Input" : "Output"}.${name}`);
  }
  for (const branch of schema.allOf ?? []) {
    intersection.push(renderSemanticSchema(branch, direction, indentLevel));
  }

  const alternatives = Array.isArray(schema.oneOf) && schema.oneOf.length > 0
    ? schema.oneOf
    : Array.isArray(schema.anyOf) && schema.anyOf.length > 0
      ? schema.anyOf
      : undefined;

  let local;
  if (schema.const !== undefined) {
    local = renderType(schema.const);
  } else if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    local = schema.enum.map((value) => renderType(value)).join(" | ");
  } else if (Array.isArray(schema.type)) {
    local = schema.type.map((type) => renderSemanticSchema({ ...schema, type }, direction, indentLevel)).join(" | ");
  } else if (schema.type === "object" || schema.properties || schema.required || schema.additionalProperties !== undefined) {
    local = renderSemanticObject(schema, direction, indentLevel);
    const refinements = renderSemanticObjectRefinements(schema, direction, indentLevel);
    if (refinements.length > 0) {
      // Why: a domain type must reject incoherent state combinations itself;
      // merely publishing the implication as metadata recreates the OpenAPI AST.
      local = `(${local}) & (${refinements.join(") & (")})`;
    }
  } else if (schema.type === "array" || schema.items) {
    local = `readonly (${renderSemanticSchema(schema.items ?? {}, direction, indentLevel)})[]`;
  } else if (schema.type === "string") {
    local = renderSemanticString(schema);
  } else if (schema.type === "integer" || schema.type === "number") {
    local = "number";
  } else if (schema.type === "boolean") {
    local = "boolean";
  } else if (schema.type === "null") {
    local = "null";
  }

  if (local && !(schema.$ref || schema.allOf)) intersection.push(local);
  else if (local && (schema.properties || schema.type || schema.oneOf || schema.anyOf || schema.enum || schema.const !== undefined)) intersection.push(local);
  if (alternatives) {
    // Why: OpenAPI combinators refine their sibling object constraints; replacing the object with
    // only the union erases fields needed by request-to-response proofs and generated consumers.
    intersection.push(
      alternatives
        .map((branch) => renderSemanticSchema(branch, direction, indentLevel))
        .map(parenthesizeUnion)
        .join(" | "),
    );
  }
  let result = intersection.length > 0 ? intersection.map(parenthesizeUnion).join(" & ") : "unknown";
  if (schema.nullable === true && result !== "null") result = `(${result}) | null`;
  return result;
}

function renderSemanticObject(schema, direction, indentLevel) {
  const required = new Set(schema.required ?? []);
  const properties = Object.entries(schema.properties ?? {}).filter(([, property]) => {
    if (direction === "request" && property.readOnly === true) return false;
    if (direction === "response" && property.writeOnly === true) return false;
    return true;
  });
  for (const name of required) {
    if (!properties.some(([property]) => property === name)) {
      properties.push([name, {}]);
    }
  }
  if (properties.length === 0) {
    if (schema.additionalProperties === false) return "Record<string, never>";
    if (isObject(schema.additionalProperties)) {
      return `Readonly<Record<string, ${renderSemanticSchema(schema.additionalProperties, direction, indentLevel)}>>`;
    }
    return "Readonly<Record<string, unknown>>";
  }
  const indentation = "  ".repeat(indentLevel + 1);
  const closing = "  ".repeat(indentLevel);
  const fields = [];
  for (const [name, property] of properties) {
    for (const line of renderDoc(property.description, property.deprecated, indentLevel + 1)) fields.push(line);
    const optional = required.has(name) ? "" : "?";
    fields.push(`${indentation}readonly ${quote(name)}${optional}: ${renderSemanticSchema(property, direction, indentLevel + 1)};`);
  }
  const object = `{\n${fields.join("\n")}\n${closing}}`;
  return schema.additionalProperties === false ? `Closed<${object}>` : object;
}

function renderSemanticObjectRefinements(schema, direction, indentLevel) {
  const refinements = [];
  for (const constraint of schema["x-simile-constraints"] ?? []) {
    const implication = constraint.implies;
    if (!implication || !Array.isArray(implication.then?.all)) continue;

    const predicates = [implication.when, ...implication.then.all];
    if (!predicates.every((predicate) => semanticPredicateIsStructural(schema, predicate, direction))) {
      continue;
    }
    if (!semanticPredicateHasRepresentableComplement(schema, implication.when)) {
      continue;
    }

    const whenTrue = renderStructuralPredicate(schema, implication.when, direction, indentLevel, true);
    const whenFalse = renderStructuralPredicate(schema, implication.when, direction, indentLevel, false);
    const consequences = implication.then.all.map((predicate) =>
      renderStructuralPredicate(schema, predicate, direction, indentLevel, true),
    );
    refinements.push(`((${whenTrue}) & (${consequences.join(") & (")})) | (${whenFalse})`);
  }
  return refinements;
}

function semanticPredicateIsStructural(schema, predicate, direction) {
  if (!isObject(predicate) || typeof predicate.path !== "string") return false;
  const segments = pointerSegments(predicate.path);
  if (segments.length !== 1) return false;
  const property = schema.properties?.[segments[0]];
  if (!isObject(property)) return false;
  if (direction === "request" && property.readOnly === true) return false;
  if (direction === "response" && property.writeOnly === true) return false;
  return Object.hasOwn(predicate, "equals") || Object.hasOwn(predicate, "state");
}

function semanticPredicateHasRepresentableComplement(schema, predicate) {
  if (!Object.hasOwn(predicate, "equals")) return true;
  const [name] = pointerSegments(predicate.path);
  return semanticSchemaIsFinite(schema.properties[name]);
}

function semanticSchemaIsFinite(schema, seen = new Set()) {
  if (!isObject(schema) || seen.has(schema)) return false;
  seen.add(schema);
  if (Object.hasOwn(schema, "const") || Array.isArray(schema.enum)) return true;
  if (schema.type === "boolean") return true;
  if (typeof schema.$ref === "string") {
    return semanticSchemaIsFinite(dereference(document, schema), seen);
  }
  for (const keyword of ["oneOf", "anyOf"]) {
    if (Array.isArray(schema[keyword]) && schema[keyword].length > 0) {
      return schema[keyword].every((branch) =>
        semanticSchemaIsFinite(branch, new Set(seen)),
      );
    }
  }
  return false;
}

function renderStructuralPredicate(schema, predicate, direction, indentLevel, matches) {
  const [name] = pointerSegments(predicate.path);
  const property = schema.properties[name];
  const propertyType = renderSemanticSchema(property, direction, indentLevel + 1);
  const key = quote(name);

  if (Object.hasOwn(predicate, "equals")) {
    const expected = renderType(predicate.equals);
    return matches
      ? `{ readonly ${key}: ${expected} }`
      : `{ readonly ${key}?: Exclude<${propertyType}, ${expected}> }`;
  }

  const state = predicate.state;
  const matching = {
    present: `{ readonly ${key}: ${propertyType} }`,
    absent: `{ readonly ${key}?: never }`,
    null: `{ readonly ${key}: null }`,
    "non-null": `{ readonly ${key}: NonNullable<${propertyType}> }`,
    "null-or-absent": `{ readonly ${key}?: null }`,
  }[state];
  const complement = {
    present: `{ readonly ${key}?: never }`,
    absent: `{ readonly ${key}: ${propertyType} }`,
    null: `{ readonly ${key}?: NonNullable<${propertyType}> }`,
    "non-null": `{ readonly ${key}?: null }`,
    "null-or-absent": `{ readonly ${key}: NonNullable<${propertyType}> }`,
  }[state];
  if (!matching || !complement) {
    throw new Error(`Unsupported structural predicate state ${JSON.stringify(state)}`);
  }
  return matches ? matching : complement;
}

function pointerSegments(pointer) {
  if (pointer === "" || pointer === "/") return [];
  return pointer.slice(1).split("/").map(decodePointer);
}

function renderSemanticString(schema) {
  if (schema.format === "date-time") return "DateTime";
  if (schema.format === "uri") return "Uri";
  if (schema.format === "email") return "EmailAddress";
  if (schema.format === "binary") return "Binary";
  const prefix = typeof schema.pattern === "string" ? schema.pattern.match(/^\^([A-Za-z0-9_]+_)$/)?.[1] : undefined;
  if (prefix) return `\`${prefix}\${string}\``;
  const alternatives = typeof schema.pattern === "string" ? schema.pattern.match(/^\^\(([^)]+)\)_\[A-Za-z0-9/) : undefined;
  if (alternatives) return alternatives[1].split("|").map((value) => `\`${value}_\${string}\``).join(" | ");
  return "string";
}

function renderDoc(description, deprecated = false, indentLevel = 0) {
  if (!description && !deprecated) return [];
  const indentation = "  ".repeat(indentLevel);
  const text = String(description ?? "").replaceAll("*/", "* /").replaceAll(/\s+/g, " ").trim();
  const details = [text, deprecated ? "@deprecated" : ""].filter(Boolean).join(" ");
  return [`${indentation}/** ${details} */`];
}

function parenthesizeUnion(value) {
  return value.includes(" | ") ? `(${value})` : value;
}

function renderInternalContract() {
  const version = document.info?.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("OpenAPI info.version is required");
  }

  const lines = [
    "// Internal compiler IR generated from commerce.yml; DO NOT EDIT OR PUBLISH AS THE TYPESCRIPT CONTRACT.",
    `// OpenAPI SHA-256: ${sourceDigest}`,
    "// This file contains declarations only and emits no JavaScript.",
    "",
    "import type {",
    "  Assert,",
    "  ConstraintsWellFormed,",
    "  InferSchema,",
    "  PathValue,",
    "  RelationWellFormed,",
    '} from "./proof-kernel";',
    "",
    `export type CollectionVersion = ${JSON.stringify(version)};`,
    `export type SourceOpenApiSha256 = ${JSON.stringify(sourceDigest)};`,
    `export type OperationCount = ${operations.length};`,
    `export type SchemaCount = ${Object.keys(schemas).length};`,
    `export type ConstraintCount = ${constraintCount()};`,
    `export type ResponseRelationCount = ${relationEntries.length};`,
    "",
    "/** Closed OpenAPI schema algebra. InferSchema turns a node into its payload type. */",
    "export interface SchemaDefinitions {",
  ];

  for (const [name, schema] of Object.entries(schemas).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`  readonly ${quote(name)}: ${renderType(projectSchema(schema), 1)};`);
  }
  lines.push(
    "}",
    "",
    "export type Schema<Name extends keyof SchemaDefinitions> = InferSchema<",
    "  SchemaDefinitions[Name],",
    "  SchemaDefinitions",
    ">;",
    "",
    "/** Every Simile clause, attached to the payload object that owns its paths. */",
    "export interface SchemaConstraintSites {",
  );

  for (const [schemaName, sites] of Object.entries(constraintSites).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    lines.push(`  readonly ${quote(schemaName)}: {`);
    for (const [pointer, constraints] of Object.entries(sites).sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      lines.push(
        `    readonly ${quote(pointer)}: ${renderType(constraints, 2)};`,
      );
    }
    lines.push("  };");
  }
  lines.push(
    "}",
    "",
    "/** HTTP operations retain request/response schemas and Simile response relations. */",
    "export interface OperationDefinitions {",
  );
  for (const operation of operations) {
    lines.push(
      `  readonly ${quote(operation.operationId)}: ${renderType(projectOperation(operation), 1)};`,
    );
  }
  lines.push(
    "}",
    "",
    "export type OperationId = keyof OperationDefinitions;",
    "",
    "export type RequestBody<",
    "  Id extends OperationId,",
    "  ContentType extends string,",
    "> = OperationDefinitions[Id] extends {",
    "  readonly request: { readonly content: infer Content };",
    "}",
    "  ? ContentType extends keyof Content",
    "    ? Content[ContentType] extends { readonly schema: infer Node }",
    "      ? InferSchema<Node, SchemaDefinitions>",
    "      : never",
    "    : never",
    "  : never;",
    "",
    "export type ResponseBody<",
    "  Id extends OperationId,",
    "  Status extends string,",
    "  ContentType extends string,",
    "> = OperationDefinitions[Id] extends { readonly responses: infer Responses }",
    "  ? Status extends keyof Responses",
    "    ? Responses[Status] extends { readonly content: infer Content }",
    "      ? ContentType extends keyof Content",
    "        ? Content[ContentType] extends { readonly schema: infer Node }",
    "          ? InferSchema<Node, SchemaDefinitions>",
    "          : never",
    "        : never",
    "      : never",
    "    : never",
    "  : never;",
    "",
    "export type ResponseRelation<",
    "  Id extends OperationId,",
    "  Status extends string,",
    "  ContentType extends string,",
    "> = OperationDefinitions[Id] extends { readonly responses: infer Responses }",
    "  ? Status extends keyof Responses",
    "    ? Responses[Status] extends { readonly content: infer Content }",
    "      ? ContentType extends keyof Content",
    "        ? Content[ContentType] extends { readonly relation: infer Relation }",
    "          ? Relation",
    "          : never",
    "        : never",
    "      : never",
    "    : never",
    "  : never;",
    "",
    "/** Named examples are literal witness types, not runtime values. */",
    "export interface OperationExamples {",
  );
  for (const [operationId, value] of Object.entries(examples).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    lines.push(`  readonly ${quote(operationId)}: ${renderType(value, 1)};`);
  }
  lines.push("}", "");

  lines.push(
    "/** Compile-time proofs that every declared constraint path resolves. */",
  );
  let proofIndex = 0;
  for (const [schemaName, sites] of Object.entries(constraintSites).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    for (const pointer of Object.keys(sites).sort()) {
      const owner = pointer === "/"
        ? `Schema<${quote(schemaName)}>`
        : `PathValue<Schema<${quote(schemaName)}>, ${quote(pointer)}>`;
      sites[pointer].forEach((_, constraintIndex) => {
        lines.push(
          `type _ConstraintProof${String(proofIndex).padStart(3, "0")} = Assert<`,
          `  ConstraintsWellFormed<${owner}, readonly [SchemaConstraintSites[${quote(schemaName)}][${quote(pointer)}][${constraintIndex}]]>`,
          ">;",
        );
        proofIndex += 1;
      });
    }
  }
  lines.push(
    "",
    "/** Compile-time proofs that every request/response relation addresses compatible payloads. */",
  );
  relationEntries.forEach((entry, index) => {
    lines.push(
      `type _RelationProof${String(index).padStart(3, "0")} = Assert<`,
      "  RelationWellFormed<",
      `    RequestBody<${quote(entry.operationId)}, ${quote(entry.contentType)}>,`,
      `    ResponseBody<${quote(entry.operationId)}, ${quote(entry.status)}, ${quote(entry.contentType)}>,`,
      `    ResponseRelation<${quote(entry.operationId)}, ${quote(entry.status)}, ${quote(entry.contentType)}>` ,
      "  >",
      ">;",
    );
  });
  return `${lines.join("\n")}\n`;
}

function projectSchema(value) {
  if (Array.isArray(value)) return value.map(projectSchema);
  if (!isObject(value)) return value;

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (!SCHEMA_KEYS.has(key)) continue;
    if (key === "properties") {
      result[key] = Object.fromEntries(
        Object.entries(child).map(([name, schema]) => [name, projectSchema(schema)]),
      );
    } else if (["allOf", "anyOf", "oneOf"].includes(key)) {
      result[key] = child.map(projectSchema);
    } else if (["items", "not", "additionalProperties"].includes(key) && isObject(child)) {
      result[key] = projectSchema(child);
    } else {
      result[key] = child;
    }
  }
  return result;
}

function projectOperation({ method, path, operationId, operation, pathItem }) {
  const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]
    .map((parameter) => dereference(document, parameter))
    .map((parameter) => ({
      name: parameter.name,
      in: parameter.in,
      required: parameter.required === true,
      schema: projectSchema(parameter.schema ?? {}),
    }));
  const result = {
    method: method.toUpperCase(),
    path,
    tags: operation.tags ?? [],
    parameters,
  };
  if (operation.security !== undefined) result.security = operation.security;

  if (operation.requestBody) {
    const requestBody = dereference(document, operation.requestBody);
    result.request = {
      required: requestBody.required === true,
      content: Object.fromEntries(
        Object.entries(requestBody.content ?? {}).map(([contentType, media]) => [
          contentType,
          { schema: projectSchema(media.schema ?? {}) },
        ]),
      ),
    };
  }

  result.responses = Object.fromEntries(
    Object.entries(operation.responses ?? {}).map(([status, responseValue]) => {
      const response = dereference(document, responseValue);
      return [
        status,
        {
          headers: Object.fromEntries(
            Object.entries(response.headers ?? {}).map(([name, headerValue]) => {
              const header = dereference(document, headerValue);
              return [name, { schema: projectSchema(header.schema ?? {}) }];
            }),
          ),
          content: Object.fromEntries(
            Object.entries(response.content ?? {}).map(([contentType, media]) => {
              const projected = { schema: projectSchema(media.schema ?? {}) };
              if (media["x-simile-from-request"] !== undefined) {
                projected.relation = media["x-simile-from-request"];
              }
              return [contentType, projected];
            }),
          ),
        },
      ];
    }),
  );
  return result;
}

function collectOperations(source) {
  const result = [];
  const ids = new Set();
  for (const [path, pathItem] of Object.entries(source.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!HTTP_METHODS.has(method)) continue;
      if (!operation?.operationId) {
        throw new Error(`${method.toUpperCase()} ${path} has no operationId`);
      }
      if (ids.has(operation.operationId)) {
        throw new Error(`Duplicate operationId ${operation.operationId}`);
      }
      ids.add(operation.operationId);
      result.push({ method, path, pathItem, operationId: operation.operationId, operation });
    }
  }
  return result.sort((left, right) => left.operationId.localeCompare(right.operationId));
}

function collectConstraintSites(sourceSchemas) {
  const result = {};
  for (const [schemaName, schema] of Object.entries(sourceSchemas)) {
    const sites = {};
    walkSchema(schema, "/", (ownerPath, constraints) => {
      sites[ownerPath] ??= [];
      sites[ownerPath].push(...constraints);
    });
    if (Object.keys(sites).length > 0) result[schemaName] = sites;
  }
  return result;
}

function walkSchema(schema, dataPath, visit) {
  if (!isObject(schema)) return;
  if (Array.isArray(schema["x-simile-constraints"])) {
    visit(dataPath, schema["x-simile-constraints"]);
  }
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    walkSchema(property, appendPointer(dataPath, name), visit);
  }
  if (schema.items) walkSchema(schema.items, appendPointer(dataPath, "*"), visit);
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    for (const branch of schema[keyword] ?? []) walkSchema(branch, dataPath, visit);
  }
  if (isObject(schema.additionalProperties)) {
    walkSchema(schema.additionalProperties, appendPointer(dataPath, "*"), visit);
  }
}

function collectRelationEntries(sourceOperations) {
  const result = [];
  for (const { operationId, operation } of sourceOperations) {
    for (const [status, responseValue] of Object.entries(operation.responses ?? {})) {
      const response = dereference(document, responseValue);
      for (const [contentType, media] of Object.entries(response.content ?? {})) {
        if (media["x-simile-from-request"] === undefined) continue;
        result.push({
          operationId,
          status,
          contentType,
          relation: media["x-simile-from-request"],
        });
      }
    }
  }
  return result;
}

function renderResponseRelationsInterface(interfaceName, relations) {
  const lines = [
    "/** Request-to-response construction rules in this contract area. */",
    `export interface ${interfaceName} {`,
  ];
  for (const [operationId, statuses] of Object.entries(relations)) {
    lines.push(`  readonly ${quote(operationId)}: ${renderType(statuses, 1)};`);
  }
  lines.push("}");
  return lines;
}

function groupResponseRelations(operationIds) {
  const grouped = {};
  for (const entry of relationEntries) {
    if (operationIds && !operationIds.has(entry.operationId)) continue;
    grouped[entry.operationId] ??= {};
    grouped[entry.operationId][entry.status] ??= {};
    grouped[entry.operationId][entry.status][entry.contentType] = entry.relation;
  }
  return Object.fromEntries(
    Object.entries(grouped)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([operationId, statuses]) => [operationId, statuses]),
  );
}

function collectExamples(sourceOperations) {
  const result = {};
  for (const { operationId, operation } of sourceOperations) {
    const operationExamples = {};
    if (operation.requestBody) {
      const requestBody = dereference(document, operation.requestBody);
      const requestExamples = {};
      for (const media of Object.values(requestBody.content ?? {})) {
        for (const [name, example] of Object.entries(media.examples ?? {})) {
          const resolved = dereference(document, example);
          if (resolved.value !== undefined) requestExamples[name] = resolved.value;
        }
      }
      if (Object.keys(requestExamples).length > 0) operationExamples.request = requestExamples;
    }

    const responseExamples = {};
    for (const [status, responseValue] of Object.entries(operation.responses ?? {})) {
      const response = dereference(document, responseValue);
      const statusExamples = {};
      for (const media of Object.values(response.content ?? {})) {
        for (const [name, example] of Object.entries(media.examples ?? {})) {
          const resolved = dereference(document, example);
          if (resolved.value !== undefined) statusExamples[name] = resolved.value;
        }
      }
      if (Object.keys(statusExamples).length > 0) responseExamples[status] = statusExamples;
    }
    if (Object.keys(responseExamples).length > 0) operationExamples.responses = responseExamples;
    if (Object.keys(operationExamples).length > 0) result[operationId] = operationExamples;
  }
  return result;
}

function dereference(source, value) {
  if (!isObject(value) || typeof value.$ref !== "string") return value;
  if (!value.$ref.startsWith("#/")) {
    throw new Error(`External reference remained in bundled contract: ${value.$ref}`);
  }
  return value.$ref
    .slice(2)
    .split("/")
    .map(decodePointer)
    .reduce((current, segment) => current?.[segment], source);
}

function renderType(value, indentLevel = 0) {
  if (value === null) return "null";
  if (["string", "number", "boolean"].includes(typeof value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "readonly []";
    const indentation = "  ".repeat(indentLevel + 1);
    const closing = "  ".repeat(indentLevel);
    return `readonly [\n${value.map((item) => `${indentation}${renderType(item, indentLevel + 1)},`).join("\n")}\n${closing}]`;
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const indentation = "  ".repeat(indentLevel + 1);
    const closing = "  ".repeat(indentLevel);
    return `{\n${entries.map(([key, item]) => `${indentation}readonly ${quote(key)}: ${renderType(item, indentLevel + 1)};`).join("\n")}\n${closing}}`;
  }
  throw new Error(`Unsupported declaration value ${String(value)}`);
}

function constraintCount() {
  let count = 0;
  for (const sites of Object.values(constraintSites)) {
    for (const constraints of Object.values(sites)) count += constraints.length;
  }
  return count;
}

function appendPointer(base, segment) {
  const encoded = segment.replaceAll("~", "~0").replaceAll("/", "~1");
  return base === "/" ? `/${encoded}` : `${base}/${encoded}`;
}

function decodePointer(segment) {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function quote(value) {
  return JSON.stringify(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
