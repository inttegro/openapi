import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const openapiDir = resolve(scriptDir, "..");
const specificationPath = resolve(openapiDir, "commerce.yml");
const configurationPath = resolve(openapiDir, "simile", "inttegro.simile.hcl");
const stateBehaviorPath = resolve(openapiDir, "simile", "state.hcl");
const behaviorPaths = ["principals.hcl", "behaviors.hcl", "errors.hcl", "state.hcl", "faults.hcl"]
  .map((file) => resolve(openapiDir, "simile", file));
const behaviorArguments = behaviorPaths.flatMap((path) => ["--behavior", path]);
const simile = process.env.SIMILE_BIN ?? resolve(openapiDir, "../simile/target/debug/simile");
const document = YAML.parse(readFileSync(specificationPath, "utf8"));
const stateBehavior = readFileSync(stateBehaviorPath, "utf8");
const methods = new Set(["delete", "get", "patch", "post", "put"]);
const work = mkdtempSync(resolve(tmpdir(), "inttegro-simile-service-"));

// Why: these inputs cover relation normalization, request-owned dynamic bounds, and composed
// response schemas that previously required test-only seeds or named-outcome fallbacks.
const synthesisRegressions = [
  ["pagePaymentMethods", { page_number: 0 }],
  ["pagePrices", { page_number: 0 }],
  ["lookupChildrenPolicy", { version: 100 }],
  ["lookupOperatingPolicy", { operating_policy_id: "op_example", version: 100 }],
];

const namedOutcomes = [
  ["tokenizePaymentMethod", [
    "tokenized",
    "payment_method_tokenized",
    {
      payment_method: {
        id: "pm_example",
        customer_id: "cu_example",
        type: "mobile_money",
        mobile_money: { account_number: "****7831", last4: "7831", network: "mtn" },
      },
    },
    {
      customer_id: "cu_example",
      type: "mobile_money",
      mobile_money: { account_number: "+233242057831", network: "mtn" },
      owner: { name: "Jane Mensah", address: { country: "GH" } },
    },
  ]],
  ["createPurchaseIntent", ["created", "purchase_intent_created", { purchase_intent: { id: "sale_example", status: "active", price: { nominal: { currency: "ghs", value: 15000 } } } }]],
  ["sendChime", ["cooldown_active", "chime_cooldown_active", { error: { code: "chime_cooldown_active" } }]],
  ["createOrder", ["payment_method_invalid", "order_payment_method_invalid", { code: "payment_method_invalid" }]],
  ["createRefund", ["currency_mismatch", "refund_currency_mismatch", { error: { code: "refund_currency_mismatch" } }]],
  ["schedulePayout", ["payout_restricted", "payout_restricted", { code: "payout_restricted" }]],
  ["tokenizePaymentMethod", ["malformed_body", "payment_method_invalid_body", { code: "invalid_request_body" }]],
  ["createProduct", ["gallery_too_large", "product_gallery_too_large", { code: "product_media_gallery_too_large" }]],
  ["createPurchaseIntent", ["invalid_quantity_range", "purchase_intent_invalid_quantity_range", { code: "invalid_purchase_intent_quantity_range" }]],
  ["sendOrderInvoice", ["invoice_sent", "order_invoice_sent", { delivery: { document_kind: "invoice", sent_channels: ["email"] }, order: { id: "or_invoice_example", status: "requires_payment" } }, { order_id: "or_invoice_example" }]],
  ["sendOrderInvoice", ["invoice_partially_sent", "order_invoice_partially_sent", { delivery: { document_kind: "invoice", sent_channels: ["email"], failed_channels: ["sms"] } }, { order_id: "or_invoice_example" }]],
  ["sendOrderReceipt", ["receipt_sent", "order_receipt_sent", { delivery: { document_kind: "receipt", sent_channels: ["email"] }, order: { id: "or_receipt_example", status: "paid" } }, { order_id: "or_receipt_example" }]],
  ["sendOrderReceipt", ["receipt_partially_sent", "order_receipt_partially_sent", { delivery: { document_kind: "receipt", sent_channels: ["email"], failed_channels: ["sms"] } }, { order_id: "or_receipt_example" }]],
  ["cancelPurchaseIntent", ["canceled", "purchase_intent_canceled", { purchase_intent: { id: "sale_canceled_example", status: "inactive", inactive_at: "2026-11-20T10:00:00Z" } }, { purchase_intent_id: "sale_canceled_example" }]],
  ["updatePurchaseIntent", ["updated", "purchase_intent_updated", { purchase_intent: { id: "sale_updated_example", status: "active", quantity: { min: 2, max: 10 } } }, { id: "sale_updated_example" }]],
  ["lookupPurchaseIntent", ["found", "purchase_intent_found", { purchase_intent: { id: "sale_found_example", status: "active" } }, { id: "sale_found_example" }]],
  ["updateOperatingPolicy", [
    "updated",
    "operating_policy_updated",
    { operating_policy: { id: "op_example", version: 2, active_version: 2, name: "Updated operating policy" } },
    { operating_policy_id: "op_example", expected_version: 1, name: "Updated operating policy" },
  ]],
];

const providerOutcomes = [
  ["verifyOTP", "otp_transaction_expired", "otp_expired", { error: { code: "otp_transaction_expired" } }],
  ["verifyOTP", "otp_max_verification_attempts_exceeded", "otp_attempts_exhausted", { error: { code: "otp_max_verification_attempts_exceeded" } }],
  ["lookupCustomer", "customer_not_found", "customer_not_found", { code: "customer_not_found" }],
  ["lookupOrder", "order_not_found", "order_not_found", { code: "order_not_found" }],
  ["lookupProduct", "product_not_found", "product_not_found", { code: "product_not_found" }],
  ["lookupPurchaseIntent", "purchase_intent_not_found", "purchase_intent_not_found", { code: "purchase_intent_not_found" }],
  ["lookupPaymentMethod", "payment_method_not_found", "payment_method_not_found", { code: "payment_method_not_found" }],
  ["createRefund", "refund_insufficient_merchant_balance", "refund_insufficient_balance", { error: { code: "refund_insufficient_merchant_balance" } }],
  ["cancelRefund", "refund_not_found", "refund_not_found", { error: { code: "refund_not_found" } }],
  ["cancelRefund", "refund_cannot_cancel", "refund_cannot_cancel", { error: { code: "refund_cannot_cancel" } }],
  ["completeOrder", "order_payment_not_paid", "order_payment_not_paid", { code: "order_payment_not_paid" }],
  ["confirmPayment", "confirmation_bad_token", "confirmation_bad_token", { error: { code: "confirmation_bad_token" } }],
  ["confirmPayment", "payment_transition_conflict", "payment_transition_conflict", { error: { code: "payment_transition_conflict" } }],
  ["lookupFile", "file_not_found", "file_not_found", { code: "file_not_found" }],
  ["openFileLink", "file_link_expired", "file_link_expired", { code: "file_link_expired" }],
  ["lookupUploadRequest", "upload_request_not_found", "upload_request_not_found", { code: "upload_request_not_found" }],
  ["fulfillUploadRequest", "upload_request_expired", "upload_request_expired", { code: "upload_request_expired" }],
  ["activatePrice", "price_archived", "price_archived", { code: "price_archived" }],
  ["archiveProduct", "product_already_archived", "product_already_archived", { code: "product_already_archived" }],
];

if (!existsSync(simile)) {
  throw new Error(`Simile binary not found at ${simile}; set SIMILE_BIN to override it`);
}

try {
  // Why: keep the state model aligned with the stable public resource vocabulary used by the API.
  const publishedCollectionNames = [...stateBehavior.matchAll(
    /^\s*collection\s*=\s*"([^"]+)"\s*$/gm,
  )].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(publishedCollectionNames)].sort(),
    [
      "applications",
      "broadcasts",
      "chimes",
      "customers",
      "file_links",
      "files",
      "financial_accounts",
      "message_templates",
      "operating_policies",
      "orders",
      "otp_transactions",
      "payment_methods",
      "payout_settings",
      "payouts",
      "prices",
      "products",
      "purchase_intents",
      "refunds",
      "scheduled_chimes",
      "secret_keys",
      "upload_requests",
    ],
    "state collection namespace inventory drifted",
  );

  // Why: direct module compilation does not prove that the published composition root resolves
  // its relative contract and behavior paths from the new `simile/` directory.
  const description = JSON.parse(runSimile([
    "describe",
    "service",
    "inttegro",
    "--config",
    configurationPath,
    "--output",
    "json",
  ]).stdout);
  assert.equal(description.service, "inttegro", "published service name drifted");
  assert.equal(description.listen, "127.0.0.1:4242", "published listener drifted");
  assert.equal(description.operationCount, 135, "composition-root operation count drifted");
  assert.equal(description.scenarios.length, 42, "published scenario catalogue drifted");
  assert.equal(description.backends.length, 3, "published backend catalogue drifted");
  assert.equal(description.asyncOperations.length, 3, "published async catalogue drifted");
  assert.equal(description.faultProfiles.length, 2, "published fault-profile catalogue drifted");
  assert.equal(description.principals.length, 1, "published principal catalogue drifted");
  assert.equal(description.profiles.length, 3, "published fixture-profile catalogue drifted");
  assert.equal(description.principalSetups.length, 1, "published setup-workflow catalogue drifted");

  const artifactPath = resolve(work, "inttegro.similec");
  runSimile([
    "compile",
    specificationPath,
    ...behaviorArguments,
    "--artifact",
    artifactPath,
    "--output",
    "json",
  ]);
  const inspection = JSON.parse(runSimile(["inspect", artifactPath, "--output", "json"]).stdout);
  assert.equal(inspection.operations, 135, "compiled public operation count drifted");
  assert.equal(inspection.publicExportSafe, true, "compiled artifact is not public-export safe");
  assert.equal(inspection.providerAuthoredOutcomes, 21, "provider-authored outcome inventory drifted");
  assert.equal(inspection.scenarioSelections, 37, "exact-outcome scenario inventory drifted");
  assert.equal(inspection.scenarioFaults, 5, "deterministic fault scenario inventory drifted");
  assert.equal(inspection.resources, 3, "abstract test-backend inventory drifted");
  assert.equal(inspection.asyncOperations, 3, "declared asynchronous-work inventory drifted");
  assert.equal(inspection.effects, 29, "public effect inventory drifted");
  assert.equal(inspection.providerAuthoredEffects, 29, "public effects must remain explicitly authored");
  // Why: Inttegro uses POST for reads, so convention-inferred writes would turn lookup operations
  // into false state mutations. Every durable consequence must remain explicitly reviewed.
  assert.equal(inspection.conventionInferredEffects, 0, "unreviewed convention-inferred effects appeared");
  assert.equal(inspection.faults, 2, "environmental fault inventory drifted");
  assert.equal(inspection.faultProfiles, 2, "fault-profile inventory drifted");
  assert.equal(inspection.securitySchemes, 1, "compiled security-scheme inventory drifted");
  assert.equal(inspection.principals, 1, "compiled principal inventory drifted");
  assert.equal(inspection.profiles, 3, "compiled fixture-profile inventory drifted");
  // Why: principal setup belongs to the composition root, while this artifact intentionally
  // compiles the portable behavior modules without service-only declarations.
  assert.equal(inspection.principalSetups, 0, "behavior modules unexpectedly declared setup");

  // Why: a successful compile can still leave public outcomes or consequences underspecified.
  // Keep every fidelity-audit category explicit so a new warning cannot enter unnoticed.
  const audit = JSON.parse(runSimile(["audit", artifactPath, "--output", "json"]).stdout);
  assert.equal(audit.errors, 0, "compiled service has fidelity-audit errors");
  const auditWarnings = Object.groupBy(audit.findings, (finding) => finding.code);
  assert.deepEqual(
    Object.keys(auditWarnings).sort(),
    ["outcome.schema_only", "state.no_effect"],
    "an unreviewed fidelity-audit warning category appeared",
  );
  assert.equal(auditWarnings["outcome.schema_only"].length, 107, "schema-only outcome inventory drifted");
  assert.equal(auditWarnings["state.no_effect"].length, 58, "explicit no-effect operation inventory drifted");

  // Why: compiling setup metadata does not prove that it can provision a durable profile or that
  // sensitive issued values stay out of machine-readable command output.
  const registryHome = resolve(work, "simile-home");
  const registryEnvironment = { SIMILE_HOME: registryHome };
  runSimile([
    "register",
    "inttegro",
    "--config",
    configurationPath,
    "--output",
    "json",
  ], true, registryEnvironment);
  const setupOutput = runSimile([
    "setup",
    "inttegro",
    "--profile",
    "contract-test",
    "--set",
    "name=Contract test application",
    "--set",
    "alias=contract-test",
    "--output",
    "json",
  ], true, registryEnvironment).stdout;
  assert.ok(!setupOutput.includes("simile_test_"), "setup output exposed a sensitive credential");
  const setup = JSON.parse(setupOutput);
  assert.equal(setup.profile.name, "contract-test", "setup profile name drifted");
  assert.equal(setup.profile.principal, "application", "setup principal drifted");
  assert.equal(setup.profile.current, true, "first setup profile was not selected");
  assert.deepEqual(setup.profile.credentialSchemes, ["bearerAuth"], "setup credential scheme drifted");
  const profileOutput = runSimile([
    "profile",
    "inttegro",
    "contract-test",
    "--output",
    "json",
  ], true, registryEnvironment).stdout;
  assert.ok(!profileOutput.includes("simile_test_"), "profile output exposed a sensitive credential");
  const credentials = readFileSync(setup.credentialsFile, "utf8");
  const issuedCredential = credentials.match(/^API_KEY="([^"]+)"$/m)?.[1];
  assert.ok(issuedCredential?.startsWith("simile_test_"), "setup did not issue a local bearer credential");

  // Why: two independently provisioned consumers are required to prove that durable state is
  // tenant-scoped rather than merely authenticated behind different credentials.
  const isolatedSetup = JSON.parse(runSimile([
    "setup",
    "inttegro",
    "--profile",
    "isolated-contract-test",
    "--set",
    "name=Isolated contract test application",
    "--set",
    "alias=isolated-contract-test",
    "--output",
    "json",
  ], true, registryEnvironment).stdout);
  const isolatedCredentials = readFileSync(isolatedSetup.credentialsFile, "utf8");
  const isolatedCredential = isolatedCredentials.match(/^API_KEY="([^"]+)"$/m)?.[1];
  assert.ok(isolatedCredential?.startsWith("simile_test_"), "second setup did not issue a credential");
  assert.notEqual(isolatedCredential, issuedCredential, "independent profiles received the same credential");

  // Why: profile compilation and setup are insufficient unless the running HTTP service actually
  // preserves public routes while enforcing active, revoked, expired, and missing credentials.
  const authenticationChecks = await verifyAuthentication(registryEnvironment, issuedCredential);
  const transportChecks = await verifyFileDeliveryTransport(registryEnvironment, issuedCredential);
  const stateChecks = await verifyStatefulProductWorkflow(
    registryEnvironment,
    issuedCredential,
    isolatedCredential,
  );

  const operations = collectOperations();
  assert.equal(operations.length, 135, "OpenAPI public operation count drifted");
  let synthesized = 0;
  for (const { operationId } of operations) {
    runSimile(["run", specificationPath, "--operation-id", operationId, "--output", "json"]);
    synthesized += 1;
  }

  for (const [operationId, body] of synthesisRegressions) {
    runOperation(operationId, body);
  }

  let supplied = 0;
  for (const { operationId, requestExample } of operations) {
    if (requestExample === undefined) continue;
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

  for (const [operationId, [outcome, scenario, expected, requestBody]] of namedOutcomes) {
    const requestArguments = requestBody === undefined
      ? []
      : ["--request", JSON.stringify({ body: requestBody })];
    const actual = JSON.parse(runSimile([
      "run",
      specificationPath,
      "--operation-id",
      operationId,
      ...requestArguments,
      "--outcome",
      outcome,
      "--output",
      "json",
    ]).stdout);
    assertPartial(actual, expected, `${operationId}.${outcome}`);

    const scenarioActual = JSON.parse(runSimile([
      "run",
      specificationPath,
      ...behaviorArguments,
      "--operation-id",
      operationId,
      ...requestArguments,
      "--scenario",
      scenario,
      "--output",
      "json",
    ]).stdout);
    assertPartial(scenarioActual, expected, `${operationId}.${scenario}`);
  }

  for (const [operationId, outcome, scenario, expected] of providerOutcomes) {
    const actual = JSON.parse(runSimile([
      "run",
      specificationPath,
      ...behaviorArguments,
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
      ...behaviorArguments,
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
      `${synthesized} operations synthesized without fallbacks, ` +
      `${synthesisRegressions.length} synthesis regressions exercised, ` +
      `${supplied} supplied valid requests replayed, ` +
      `${namedOutcomes.length} contract outcomes and ${providerOutcomes.length} provider outcomes selected, ` +
      `${invalidRequests.length} invalid requests rejected, ` +
      `${authenticationChecks} authentication cases verified, ` +
      `${transportChecks} transport responses verified, ` +
      `${stateChecks} stateful product checks verified, ` +
      `${audit.warnings} reviewed fidelity warnings, ` +
      `0 runtime synthesis gaps`,
  );
} finally {
  // Why: failed durable-state tests are otherwise impossible to diagnose after cleanup. Retain
  // the isolated registry only when a maintainer explicitly opts in; normal CI remains spotless.
  if (process.env.SIMILE_KEEP_TEST_WORK === "1") {
    console.error(`Retained Simile test work at ${work}`);
  } else {
    rmSync(work, { recursive: true, force: true });
  }
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
  const args = [
    "run",
    specificationPath,
    "--operation-id",
    operationId,
    "--request",
    JSON.stringify({ body }),
  ];
  args.push("--output", "json");
  return runSimile(args, shouldSucceed);
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

async function verifyAuthentication(environment, issuedCredential) {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const service = spawn(simile, ["start", "inttegro", "--port", String(port)], {
    cwd: openapiDir,
    env: { ...process.env, SIMILE_COLOR: "never", ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  service.stdout.on("data", (chunk) => { output += chunk; });
  service.stderr.on("data", (chunk) => { output += chunk; });

  try {
    const publicResponse = await waitForService(service, `${baseUrl}/spec/countries`, () => output);
    assert.equal(publicResponse.status, 200, "public operation unexpectedly required authentication");

    const cases = [
      [undefined, 401, "missing credential"],
      ["simile_test_active", 200, "active fixture credential"],
      ["simile_test_revoked", 401, "revoked fixture credential"],
      ["simile_test_expired", 401, "expired fixture credential"],
      [issuedCredential, 200, "setup-issued credential"],
    ];
    for (const [credential, expectedStatus, label] of cases) {
      const headers = credential === undefined
        ? {}
        : { authorization: `Bearer ${credential}` };
      const response = await fetch(`${baseUrl}/apps/lookup`, { method: "POST", headers });
      assert.equal(response.status, expectedStatus, `${label} returned an unexpected status`);
    }
    return cases.length;
  } finally {
    await stopService(service);
  }
}

async function verifyFileDeliveryTransport(environment, issuedCredential) {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const service = spawn(simile, ["start", "inttegro", "--port", String(port)], {
    cwd: openapiDir,
    env: { ...process.env, SIMILE_COLOR: "never", ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  service.stdout.on("data", (chunk) => { output += chunk; });
  service.stderr.on("data", (chunk) => { output += chunk; });

  try {
    await waitForService(service, `${baseUrl}/spec/countries`, () => output);
    const headers = {
      authorization: `Bearer ${issuedCredential}`,
      "content-type": "application/json",
    };
    const streamed = await fetch(`${baseUrl}/files/contents`, {
      method: "POST",
      headers,
      body: JSON.stringify({ file_id: "file_example", delivery: "stream" }),
      redirect: "manual",
    });
    assert.equal(streamed.status, 200, "stream delivery did not select its binary response");
    assert.equal(
      streamed.headers.get("content-type"),
      "application/octet-stream",
      "stream delivery returned the wrong media type",
    );
    assert.ok((await streamed.arrayBuffer()).byteLength > 0, "stream delivery returned no bytes");

    const redirected = await fetch(`${baseUrl}/files/contents`, {
      method: "POST",
      headers,
      body: JSON.stringify({ file_id: "file_example", delivery: "redirect" }),
      redirect: "manual",
    });
    assert.equal(redirected.status, 303, "redirect delivery did not select its declared response");
    assert.equal(
      redirected.headers.get("location"),
      "https://files.example.test/download/file_example",
      "redirect delivery did not return its declared Location header",
    );
  } finally {
    await stopService(service);
  }

  const scenarioPort = await availablePort();
  const scenarioBaseUrl = `http://127.0.0.1:${scenarioPort}`;
  const scenarioService = spawn(
    simile,
    ["start", "inttegro", "--port", String(scenarioPort), "--scenario", "file_link_redirect"],
    {
      cwd: openapiDir,
      env: { ...process.env, SIMILE_COLOR: "never", ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let scenarioOutput = "";
  scenarioService.stdout.on("data", (chunk) => { scenarioOutput += chunk; });
  scenarioService.stderr.on("data", (chunk) => { scenarioOutput += chunk; });

  try {
    await waitForService(
      scenarioService,
      `${scenarioBaseUrl}/spec/countries`,
      () => scenarioOutput,
    );
    const response = await fetch(
      `${scenarioBaseUrl}/file_links/open?id=link_example&token=token_example`,
      { redirect: "manual" },
    );
    assert.equal(response.status, 302, "file-link redirect scenario selected the wrong status");
    assert.equal(
      response.headers.get("location"),
      "https://files.example.test/download/file_link_example",
      "file-link redirect scenario did not return its declared Location header",
    );
  } finally {
    await stopService(scenarioService);
  }

  return 3;
}

async function verifyStatefulProductWorkflow(environment, issuedCredential, isolatedCredential) {
  const headers = {
    authorization: `Bearer ${issuedCredential}`,
    "content-type": "application/json",
  };
  const first = await startRegisteredService(environment);
  let product;
  let price;
  let purchaseIntent;
  let order;
  let checks = 0;
  try {
    const createdResponse = await fetch(`${first.baseUrl}/products/create`, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "digital", name: "Stateful integration guide", publish: true }),
    });
    assert.equal(createdResponse.status, 200, "stateful product creation failed");
    const created = await createdResponse.json();
    product = created.product;
    assert.ok(product?.id, "stateful product creation returned no identifier");
    checks += 1;

    // Why: an update must preserve identity and request-owned fields while staying within its
    // intentionally narrower response contract; full-field preservation is checked by lookup.
    const updatedResponse = await fetch(`${first.baseUrl}/products/update`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        product_id: product.id,
        name: "Stateful integration guide, second edition",
        description: "Exercises mutation replay and durable state.",
      }),
    });
    const updatedBody = await updatedResponse.text();
    assert.equal(
      updatedResponse.status,
      200,
      `stateful product update failed after storing ${JSON.stringify(product)}: ${updatedBody}\n${first.output()}`,
    );
    const updated = JSON.parse(updatedBody).product;
    assert.equal(updated.id, product.id, "product update changed the resource identity");
    assert.equal(updated.name, "Stateful integration guide, second edition", "product update lost the new name");
    assert.equal(updated.type, product.type, "product update changed an untouched product type");
    assert.equal(updated.active, undefined, "product update escaped its narrow public response shape");
    product = { ...product, ...updated };
    checks += 1;

    // Why: a useful emulator must return the snapshot committed by creation rather than synthesize
    // an unrelated resource merely because the lookup response schema permits one.
    const lookupResponse = await fetch(`${first.baseUrl}/products/lookup`, {
      method: "POST",
      headers,
      body: JSON.stringify({ product_id: product.id }),
    });
    assert.equal(lookupResponse.status, 200, "stateful product lookup failed");
    const lookedUpProduct = (await lookupResponse.json()).product;
    assert.deepEqual(lookedUpProduct, product, "lookup did not replay merged product state");
    assert.equal(lookedUpProduct.active, true, "product update erased the stored publication state");
    checks += 1;

    const pageResponse = await fetch(`${first.baseUrl}/products/page`, {
      method: "POST",
      headers,
      body: JSON.stringify({ page_number: 1, page_size: 25 }),
    });
    assert.equal(pageResponse.status, 200, "stateful product page failed");
    const page = (await pageResponse.json()).page;
    assert.ok(page.products.some((candidate) => candidate.id === product.id), "page omitted stored product");
    assert.equal(page.size, page.products.length, "page size did not reconcile with stored products");
    checks += 1;

    // Why: authenticating a second consumer is insufficient proof of isolation; the same running
    // service must show that its catalog projection cannot observe the first profile's write.
    const isolatedPageResponse = await fetch(`${first.baseUrl}/products/page`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${isolatedCredential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ page_number: 1, page_size: 25 }),
    });
    assert.equal(isolatedPageResponse.status, 200, "isolated profile product page failed");
    const isolatedPage = (await isolatedPageResponse.json()).page;
    assert.ok(
      !isolatedPage.products.some((candidate) => candidate.id === product.id),
      "a product written by one profile leaked into another profile",
    );
    checks += 1;

    // Why: resource IDs returned by one operation must remain usable by dependent operations; a
    // schema-valid but unrelated price would make the emulator unsuitable for workflow testing.
    const priceResponse = await fetch(`${first.baseUrl}/products/add_price`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        product_id: product.id,
        label: "Stateful integration price",
        type: "fixed_amount",
        fixed_amount: { currency: "ghs", value: 20000 },
      }),
    });
    assert.equal(priceResponse.status, 200, "stateful product price creation failed");
    price = (await priceResponse.json()).price;
    assert.ok(price?.id, "stateful product price creation returned no identifier");
    assert.equal(price.product_id, product.id, "created price did not retain its product reference");
    assert.deepEqual(price.fixed_amount, { currency: "ghs", value: 20000 }, "created price changed its amount");
    checks += 1;

    const priceLookupResponse = await fetch(`${first.baseUrl}/prices/lookup`, {
      method: "POST",
      headers,
      body: JSON.stringify({ price_id: price.id }),
    });
    assert.equal(priceLookupResponse.status, 200, "stateful price lookup failed");
    assert.deepEqual((await priceLookupResponse.json()).price, price, "price lookup did not replay stored state");
    checks += 1;

    const pricePageResponse = await fetch(`${first.baseUrl}/prices/page`, {
      method: "POST",
      headers,
      body: JSON.stringify({ page_number: 1, page_size: 25, product_id: product.id }),
    });
    assert.equal(pricePageResponse.status, 200, "stateful price page failed");
    const pricePage = (await pricePageResponse.json()).page;
    assert.ok(pricePage.prices.some((candidate) => candidate.id === price.id), "price page omitted stored price");
    assert.equal(pricePage.size, pricePage.prices.length, "price page size did not reconcile with stored prices");
    checks += 1;

    const purchaseIntentResponse = await fetch(`${first.baseUrl}/purchase_intents/create`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        product_id: product.id,
        price_id: price.id,
        quantity: { min: 1, max: 3 },
        usage: { multi_use: true },
      }),
    });
    const purchaseIntentBody = await purchaseIntentResponse.text();
    assert.equal(
      purchaseIntentResponse.status,
      200,
      `stateful Buy-link creation failed: ${purchaseIntentBody}\n${first.output()}`,
    );
    purchaseIntent = JSON.parse(purchaseIntentBody).purchase_intent;
    assert.ok(purchaseIntent?.id, "stateful Buy-link creation returned no identifier");
    assert.equal(purchaseIntent.product?.id, product.id, "Buy link did not retain its product reference");
    assert.equal(purchaseIntent.price?.id, price.id, "Buy link did not retain its price reference");
    checks += 1;

    const purchaseIntentLookupResponse = await fetch(`${first.baseUrl}/purchase_intents/lookup`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: purchaseIntent.id }),
    });
    const purchaseIntentLookupBody = await purchaseIntentLookupResponse.text();
    assert.equal(
      purchaseIntentLookupResponse.status,
      200,
      `stateful Buy-link lookup failed after storing ${JSON.stringify(purchaseIntent)}: ${purchaseIntentLookupBody}\n${first.output()}`,
    );
    assert.deepEqual(
      JSON.parse(purchaseIntentLookupBody).purchase_intent,
      purchaseIntent,
      "Buy-link lookup did not replay stored state",
    );
    checks += 1;

    // Why: a real catalog workflow sends the stored price reference, not a duplicated amount. This
    // proves that state resolution snapshots the public price and reconciles the resulting total.
    const orderResponse = await fetch(`${first.baseUrl}/orders/create`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        customer_data: { name: "Stateful Test Customer", email_address: "stateful@example.test" },
        finalize: true,
        execute_payment: false,
        line_items: [{
          type: "product",
          product: { product_id: product.id, price_id: price.id, quantity: 2 },
        }],
      }),
    });
    const orderBody = await orderResponse.text();
    assert.equal(
      orderResponse.status,
      200,
      `stateful order creation failed: ${orderBody}\n${first.output()}`,
    );
    order = JSON.parse(orderBody).order;
    assert.ok(order?.id, "stateful order creation returned no identifier");
    assert.equal(order.status, "requires_payment", "stateful order selected the wrong lifecycle branch");
    assert.equal(
      order.line_item_group.line_items[0].product.product_id,
      product.id,
      "order did not retain its product reference",
    );
    assert.deepEqual(
      order.line_item_group.line_items[0].product.price,
      price.fixed_amount,
      "order did not snapshot the amount resolved from the stored price",
    );
    assert.equal(
      order.line_item_group.line_items[0].product.price_id,
      price.id,
      "order did not retain the stored price reference",
    );
    assert.deepEqual(
      order.line_item_group.total,
      { currency: price.fixed_amount.currency, value: price.fixed_amount.value * 2 },
      "order total did not reconcile with the resolved price and quantity",
    );
    checks += 1;

    const orderLookupResponse = await fetch(`${first.baseUrl}/orders/lookup`, {
      method: "POST",
      headers,
      body: JSON.stringify({ order_id: order.id }),
    });
    assert.equal(orderLookupResponse.status, 200, "stateful order lookup failed");
    assert.deepEqual((await orderLookupResponse.json()).order, order, "order lookup did not replay stored state");
    checks += 1;
  } finally {
    await stopService(first.service);
  }

  // Why: in-process reads do not prove durable emulation. Restart the registered service and
  // require every resource in the workflow to survive as the exact previously committed snapshot.
  const restarted = await startRegisteredService(environment);
  try {
    for (const [path, body, field, expected] of [
      ["/products/lookup", { product_id: product.id }, "product", product],
      ["/prices/lookup", { price_id: price.id }, "price", price],
      ["/purchase_intents/lookup", { id: purchaseIntent.id }, "purchase_intent", purchaseIntent],
      ["/orders/lookup", { order_id: order.id }, "order", order],
    ]) {
      const response = await fetch(`${restarted.baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 200, `${path} failed after service restart`);
      assert.deepEqual((await response.json())[field], expected, `${path} lost durable state after restart`);
      checks += 1;
    }
    // Why: persistence must retain the tenant boundary as well as the resource documents.
    const isolatedResponse = await fetch(`${restarted.baseUrl}/products/page`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${isolatedCredential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ page_number: 1, page_size: 25 }),
    });
    assert.equal(isolatedResponse.status, 200, "isolated profile page failed after restart");
    const isolatedPage = (await isolatedResponse.json()).page;
    assert.ok(
      !isolatedPage.products.some((candidate) => candidate.id === product.id),
      "restart collapsed independently persisted profile state",
    );
    checks += 1;
  } finally {
    await stopService(restarted.service);
  }
  return checks;
}

async function startRegisteredService(environment) {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const service = spawn(simile, ["start", "inttegro", "--port", String(port)], {
    cwd: openapiDir,
    env: { ...process.env, SIMILE_COLOR: "never", ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  service.stdout.on("data", (chunk) => { output += chunk; });
  service.stderr.on("data", (chunk) => { output += chunk; });
  await waitForService(service, `${baseUrl}/spec/countries`, () => output);
  return { baseUrl, service, output: () => output };
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close((error) => {
        if (error) reject(error);
        else if (port === undefined) reject(new Error("could not allocate an HTTP test port"));
        else resolvePort(port);
      });
    });
  });
}

async function waitForService(service, url, serviceOutput) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (service.exitCode !== null) {
      throw new Error(`Simile service exited before readiness\n${serviceOutput()}`);
    }
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }
  throw new Error(`Simile service did not become ready\n${serviceOutput()}`);
}

async function stopService(service) {
  if (service.exitCode !== null) return;
  const exited = new Promise((resolveExit) => service.once("exit", resolveExit));
  service.kill("SIGINT");
  await Promise.race([
    exited,
    new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000)),
  ]);
  if (service.exitCode === null) service.kill("SIGTERM");
}

function runSimile(args, shouldSucceed = true, environment = {}) {
  const result = spawnSync(simile, args, {
    cwd: openapiDir,
    encoding: "utf8",
    env: { ...process.env, SIMILE_COLOR: "never", ...environment },
  });
  if ((result.status === 0) !== shouldSucceed) {
    const expectation = shouldSucceed ? "succeed" : "fail";
    throw new Error(
      `Expected simile ${args.join(" ")} to ${expectation}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}
