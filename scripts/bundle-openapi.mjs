import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const sourcePath = resolve(rootDir, "src/openapi.yml");
const resourceDir = resolve(rootDir, "src/resources");
const outputPath = resolve(rootDir, "commerce.yml");
const sourceText = readFileSync(sourcePath, "utf8");
const sourceDocument = YAML.parse(sourceText);
const resources = loadResources();

// Why: a syntax-aware assembler preserves compact YAML and collocated rationale comments.
// Redocly remains the reference resolver and linter, while customers still receive one document.
const output = [
  "# Generated from src/openapi.yml by `npm run openapi:bundle`. Do not edit directly.\n",
  sourceHeader(),
  "paths:\n",
];

for (const [path, reference] of Object.entries(sourceDocument.paths ?? {})) {
  const target = resolveReference(reference?.$ref, "paths", path);
  output.push(localizeReferences(target.text));
  target.used = true;
}

output.push("components:\n");
for (const [section, entries] of Object.entries(sourceDocument.components ?? {})) {
  output.push(`    ${section}:\n`);
  for (const [name, reference] of Object.entries(entries ?? {})) {
    const target = resolveReference(reference?.$ref, `components/${section}`, name);
    output.push(localizeReferences(target.text));
    target.used = true;
  }
}

assertEverySourceBlockUsed();
const generated = output.join("");
// Why: the published artifact must work in clients that import only commerce.yml and cannot
// resolve repository-relative resource files.
assert.doesNotMatch(
  generated,
  /["']\.\/[^"']+\.yml#\/components\//,
  "portable bundle contains an external resource reference",
);

if (process.argv.includes("--check")) {
  if (readFileSync(outputPath, "utf8") !== generated) {
    throw new Error("commerce.yml is stale; run npm run openapi:bundle");
  }
  console.log("commerce.yml matches the modular resource contract");
} else {
  writeFileSync(outputPath, generated);
  console.log(`Bundled ${sourcePath} into ${outputPath}`);
}

function sourceHeader() {
  const lines = sourceText.match(/.*(?:\n|$)/g).filter(Boolean);
  const pathsLine = lines.findIndex((line) => line === "paths:\n" || line === "paths:");
  assert.ok(pathsLine >= 0, "src/openapi.yml has no top-level paths map");
  return lines
    .slice(0, pathsLine)
    .filter((line) => !line.startsWith("# Authoritative modular OpenAPI source."))
    .filter((line) => !line.startsWith("# Why: consumers still receive one portable document"))
    .join("");
}

function loadResources() {
  const result = new Map();
  for (const fileName of readdirSync(resourceDir).filter((name) => name.endsWith(".yml")).sort()) {
    const text = readFileSync(resolve(resourceDir, fileName), "utf8");
    const lines = text.match(/.*(?:\n|$)/g).filter(Boolean);
    const pathsLine = findTopLevel(lines, "paths");
    const componentsLine = findTopLevel(lines, "components");
    const pathsEnd = componentsLine >= 0 ? componentsLine : lines.length;
    const paths = pathsLine >= 0 ? splitBlocks(lines, pathsLine + 1, pathsEnd, 4) : [];
    const components = new Map();
    if (componentsLine >= 0) {
      for (const section of splitBlocks(lines, componentsLine + 1, lines.length, 4)) {
        components.set(section.key, splitBlocks(lines, section.start + 1, section.end, 8));
      }
    }
    result.set(fileName, {
      paths: new Map(paths.map((block) => [block.key, block])),
      components: new Map(
        [...components].map(([section, blocks]) => [
          section,
          new Map(blocks.map((block) => [block.key, block])),
        ]),
      ),
    });
  }
  return result;
}

function resolveReference(reference, expectedSection, expectedName) {
  assert.equal(typeof reference, "string", `${expectedSection}/${expectedName} must use $ref`);
  const match = reference.match(/^\.\/resources\/([^#]+)#\/(paths|components\/[^/]+)\/(.+)$/);
  assert.ok(match, `unsupported modular reference ${reference}`);
  const [, fileName, section, encodedName] = match;
  assert.equal(section, expectedSection, `${reference} resolves to the wrong section`);
  const name = unescapePointer(encodedName);
  assert.equal(name, expectedName, `${reference} resolves to ${name}, expected ${expectedName}`);
  const resource = resources.get(fileName);
  assert.ok(resource, `missing resource file ${fileName}`);
  const block = section === "paths"
    ? resource.paths.get(name)
    : resource.components.get(section.slice("components/".length))?.get(name);
  assert.ok(block, `missing source block ${reference}`);
  return block;
}

function assertEverySourceBlockUsed() {
  for (const [fileName, resource] of resources) {
    for (const block of resource.paths.values()) {
      assert.equal(block.used, true, `${fileName} path ${block.key} is absent from src/openapi.yml`);
    }
    for (const [section, blocks] of resource.components) {
      for (const block of blocks.values()) {
        assert.equal(
          block.used,
          true,
          `${fileName} component ${section}/${block.key} is absent from src/openapi.yml`,
        );
      }
    }
  }
}

function localizeReferences(text) {
  return text.replace(
    /(["'])\.\/[^"']+\.yml(#\/components\/[^"']+)\1/g,
    (_match, quote, pointer) => `${quote}${pointer}${quote}`,
  );
}

function findTopLevel(lines, key) {
  return lines.findIndex((line) => line === `${key}:\n` || line === `${key}:`);
}

function splitBlocks(lines, start, end, spaces) {
  const prefix = " ".repeat(spaces);
  const starts = [];
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (!line.startsWith(prefix) || line.startsWith(`${prefix} `) || line.trimStart().startsWith("#")) {
      continue;
    }
    const match = line.match(/^\s*([^:]+):\s*(?:\n)?$/);
    if (match) starts.push({ index, key: match[1] });
  }
  return starts.map((entry, index) => {
    const blockEnd = starts[index + 1]?.index ?? end;
    return {
      key: entry.key,
      start: entry.index,
      end: blockEnd,
      text: lines.slice(entry.index, blockEnd).join(""),
      used: false,
    };
  });
}

function unescapePointer(value) {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}
