import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const openapiDir = resolve(scriptDir, "..");
const specificationPath = resolve(openapiDir, "commerce.yml");
const behaviorPath = resolve(openapiDir, "behaviors.hcl");
const simile = process.env.SIMILE_BIN ?? resolve(openapiDir, "../simile/target/debug/simile");
const document = YAML.parse(readFileSync(specificationPath, "utf8"));
const methods = new Set(["delete", "get", "patch", "post", "put"]);
const work = mkdtempSync(resolve(tmpdir(), "inttegro-simile-service-"));

// Why: these operations intentionally return transport-level content instead of a JSON body,
// so `simile run` cannot exercise them through its JSON request/response runner.
const nonJsonOperations = new Map([
  ["openFileLink", "302 redirect with a Location header"],
  ["streamFileContents", "application/octet-stream file body"],
]);

// Why: these historical lookups accept any positive version, while the response independently
// requires `version <= active_version`. Current Simile can prove a supplied finite version but its
// unconstrained request generator can choose a value beyond the response search horizon.
const synthesisSeeds = new Map([
  ["lookupChildrenPolicy", { version: 1 }],
  ["lookupOperatingPolicy", { operating_policy_id: "op_example", version: 1 }],
  // Why: current Simile intermittently omits the optional page number and then
  // fails to preserve its declared default in the synthesized response. The
  // explicit public default keeps this contract gate deterministic while the
  // simulator implementation is corrected independently.
  ["pagePaymentMethods", { page_number: 1 }],
  ["updateOperatingPolicy", {
    operating_policy_id: "op_example",
    expected_version: 1,
    name: "Updated operating policy",
  }],
]);

// Why: this page is valid and compiles, but current Simile finite search sometimes chooses a
// non-empty array and cannot complete an item through PurchaseIntent's product-or-bundle union.
const runtimeSynthesisGaps = new Map([
  ["pagePurchaseIntents", "array-item synthesis through the purchase-intent target union"],
]);

const namedOutcomes = [
  ["tokenizePaymentMethod", ["tokenized", "payment_method_tokenized", { payment_method: { id: "pm_example", mobile_money: { account_number: "****7831" } } }]],
  ["createPurchaseIntent", ["created", "purchase_intent_created", { purchase_intent: { id: "sale_example", status: "active", price: { nominal: { currency: "ghs", value: 15000 } } } }]],
  ["sendChime", ["cooldown_active", "chime_cooldown_active", { error: { code: "chime_cooldown_active" } }]],
  ["createOrder", ["payment_method_invalid", "order_payment_method_invalid", { code: "payment_method_invalid" }]],
  ["createRefund", ["currency_mismatch", "refund_currency_mismatch", { error: { code: "refund_currency_mismatch" } }]],
  ["schedulePayout", ["payout_restricted", "payout_restricted", { code: "payout_restricted" }]],
  ["tokenizePaymentMethod", ["malformed_body", "payment_method_invalid_body", { code: "invalid_request_body" }]],
  ["createProduct", ["gallery_too_large", "product_gallery_too_large", { code: "product_media_gallery_too_large" }]],
  ["createPurchaseIntent", ["invalid_quantity_range", "purchase_intent_invalid_quantity_range", { code: "invalid_purchase_intent_quantity_range" }]],
];

if (!existsSync(simile)) {
  throw new Error(`Simile binary not found at ${simile}; set SIMILE_BIN to override it`);
}

try {
  const artifactPath = resolve(work, "inttegro.similec");
  runSimile([
    "compile",
    specificationPath,
    "--behavior",
    behaviorPath,
    "--artifact",
    artifactPath,
    "--output",
    "json",
  ]);
  const inspection = JSON.parse(runSimile(["inspect", artifactPath, "--output", "json"]).stdout);
  assert.equal(inspection.operations, 135, "compiled public operation count drifted");
  assert.equal(inspection.publicExportSafe, true, "compiled artifact is not public-export safe");
  // Why: request-dependent successes are exercised through relations, not unconditional scenarios
  // that could return a response inconsistent with the submitted request.
  assert.equal(inspection.scenarioSelections, 9, "exact-outcome scenario inventory drifted");

  const operations = collectOperations();
  assert.equal(operations.length, 135, "OpenAPI public operation count drifted");
  let synthesized = 0;
  let seeded = 0;
  let deferred = 0;
  for (const { operationId } of operations) {
    if (nonJsonOperations.has(operationId)) continue;
    if (runtimeSynthesisGaps.has(operationId)) {
      deferred += 1;
      continue;
    }
    if (synthesisSeeds.has(operationId)) {
      runOperation(operationId, synthesisSeeds.get(operationId));
      seeded += 1;
      continue;
    }
    runSimile(["run", specificationPath, "--operation-id", operationId, "--output", "json"]);
    synthesized += 1;
  }

  let supplied = 0;
  for (const { operationId, requestExample } of operations) {
    if (requestExample === undefined || nonJsonOperations.has(operationId)) continue;
    runOperation(operationId, requestExample);
    supplied += 1;
  }

  // Why: Simile normally selects one union branch; explicit fixtures keep the less-common bank
  // owner-source alternatives and Dosh marker constructible as the public handler accepts them.
  const alternativeRequests = [
    ["createFinancialAccount", {
      label: "Settlement Bank Account",
      reference: "SETTLEMENT-BANK-OWNER",
      type: "bank_account",
      currency: "ghs",
      owner: { name: "Ama Mensah", address: { country: "GH" } },
      bank_account: {
	type: "ghana_bank_account",
	ghana_bank_account: { number: "0123456789", sort_code: "120100" },
      },
    }],
    ["connectFinancialAccount", {
      label: "Holder Supplied Bank",
      reference: "SETTLEMENT-BANK-HOLDER",
      type: "bank_account",
      currency: "ghs",
      bank_account: {
	type: "ghana_bank_account",
	ghana_bank_account: {
	  number: "0123456789",
	  swift_code: "GHCBGHAC",
	  holder: { name: "Ama Mensah", address: { country: "GH" } },
	},
      },
    }],
    ["createFinancialAccount", {
      label: "Dosh Settlement Account",
      reference: "DOSH-SETTLEMENT-ACCOUNT",
      type: "dosh_account",
      currency: "ghs",
      owner: { name: "Ama Mensah", address: { country: "GH" } },
      dosh_account: {},
    }],
    ["createPurchaseIntent", {
      bundle_id: "pbd_abc123",
      quantity: { min: 1, max: 5 },
      usage: { multi_use: true },
    }],
    ["createPurchaseIntent", {
      bundle: { id: "pbd_abc123" },
      price_id: "pr_special_offer",
      quantity: { min: 1, max: 5 },
      usage: { multi_use: true },
    }],
    // Why: the input aging reference expands to a response snapshot while every other capability
    // leaf must survive unchanged, so a full fixture guards more than the generator's usual branch.
    ["createOperatingPolicy", {
      name: "Strict operating policy",
      description: "Exercises every caller-controlled capability leaf",
      capabilities: {
        payments: { currencies: ["ghs"], limits: { amount: { min: 100, max: 10_000 } } },
        payouts: {
          enabled: true,
          limits: { amount: { min: 200, max: 8_000 } },
          bt_aging_spec: { id: "bt_aging_spec_48_hourly" },
        },
        payment_methods: { mobile_money: { enabled: true, confirms_use: true } },
      },
    }],
  ];
  for (const [operationId, body] of alternativeRequests) {
    runOperation(operationId, body);
    supplied += 1;
  }

  for (const [operationId, [outcome, scenario, expected]] of namedOutcomes) {
    const actual = JSON.parse(runSimile([
      "run",
      specificationPath,
      "--operation-id",
      operationId,
      "--outcome",
      outcome,
      "--output",
      "json",
    ]).stdout);
    assertPartial(actual, expected, `${operationId}.${outcome}`);

    const scenarioActual = JSON.parse(runSimile([
      "run",
      specificationPath,
      "--behavior",
      behaviorPath,
      "--operation-id",
      operationId,
      "--scenario",
      scenario,
      "--output",
      "json",
    ]).stdout);
    assertPartial(scenarioActual, expected, `${operationId}.${scenario}`);
  }

  // Why: positive synthesis alone can hide a broadened schema; these payloads prove the repaired
  // alternatives still reject missing subtype data and incoherent purchase-intent combinations.
  const invalidRequests = [
    ["createFinancialAccount", {
      label: "Missing wallet",
      reference: "INVALID-WALLET",
      type: "wallet",
      currency: "ghs",
      owner: { name: "Ama Mensah", address: { country: "GH" } },
    }],
    ["connectFinancialAccount", {
      label: "Missing owner",
      reference: "INVALID-CONNECTION",
      type: "wallet",
      currency: "ghs",
      wallet: { type: "mobile_money", mobile_money: { network: "mtn", account_number: "+233242057831" } },
    }],
    ["tokenizePaymentMethod", {
      type: "mobile_money",
      mobile_money: { network: "unsupported", account_number: "+233242057831" },
    }],
    ["createPurchaseIntent", {
      product_id: "prod_abc123",
      price_id: "pr_xyz789",
      bundle_id: "pbd_abc123",
      quantity: { min: 5, max: 1 },
    }],
  ];
  for (const [operationId, body] of invalidRequests) {
    runOperation(operationId, body, false);
  }

  console.log(
    `Inttegro Simile service verified: ${operations.length} operations, ` +
      `${synthesized} JSON operations synthesized, ${seeded} request seeds applied, ` +
      `${deferred} runtime synthesis gap documented, ` +
      `${supplied} supplied valid requests replayed, ` +
      `${namedOutcomes.length} named outcomes selected, ${invalidRequests.length} invalid requests rejected, ` +
      `${nonJsonOperations.size} transport-only operations documented`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

function collectOperations() {
  const operations = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(item ?? {})) {
      if (!methods.has(method)) continue;
      assert.ok(operation.operationId, `${method.toUpperCase()} ${path} has no operationId`);
      const media = operation.requestBody?.content?.["application/json"];
      const firstNamedExample = media?.examples && Object.values(media.examples)[0]?.value;
      operations.push({
	operationId: operation.operationId,
	requestExample: media?.example ?? firstNamedExample,
      });
    }
  }
  return operations;
}

function runOperation(operationId, body, shouldSucceed = true) {
  return runSimile([
    "run",
    specificationPath,
    "--operation-id",
    operationId,
    "--request",
    JSON.stringify({ body }),
    "--output",
    "json",
  ], shouldSucceed);
}

function assertPartial(actual, expected, label) {
  if (expected === null || typeof expected !== "object" || Array.isArray(expected)) {
    assert.deepEqual(actual, expected, `${label} differs from its named OpenAPI outcome`);
    return;
  }
  assert.ok(actual && typeof actual === "object", `${label} did not return an object`);
  for (const [key, value] of Object.entries(expected)) {
    assertPartial(actual[key], value, `${label}.${key}`);
  }
}

function runSimile(args, shouldSucceed = true) {
  const result = spawnSync(simile, args, {
    cwd: openapiDir,
    encoding: "utf8",
    env: { ...process.env, SIMILE_COLOR: "never" },
  });
  if ((result.status === 0) !== shouldSucceed) {
    const expectation = shouldSucceed ? "succeed" : "fail";
    throw new Error(
      `Expected simile ${args.join(" ")} to ${expectation}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}
