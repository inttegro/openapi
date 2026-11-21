import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const document = YAML.parse(readFileSync(resolve(scriptDir, "..", "commerce.yml"), "utf8"));
const schemas = document.components.schemas;

// Why: these assertions cover operation-level facts that a broad component schema cannot
// preserve on its own. They keep generation from regressing to merely schema-shaped output.
assertClosedShipmentUnion();
assertProductResponseSemantics();
assertPurchaseIntentTargetUnion();
assertOrderDeliveryResponses();
assertPayoutLifecycleResponses();
assertBoundedSecretKeyPage();

console.log("Response fidelity verified for shipment, document delivery, payouts, Buy links, and key pages");

function assertClosedShipmentUnion() {
  const shipment = schemas.ProductShipment;
  assert.equal(shipment.oneOf?.length, 5);

  const expected = new Set(["delivery", "download", "render", "service", "stream"]);
  for (const branch of shipment.oneOf) {
    assert.equal(branch.additionalProperties, false);
    assert.deepEqual(branch.required, ["type"]);
    const [kind] = branch.properties.type.enum;
    assert.ok(expected.delete(kind), `unexpected or duplicate ProductShipment branch ${kind}`);
    assert.deepEqual(
      Object.keys(branch.properties).sort(),
      ["type", kind].sort(),
      `${kind} shipment branch exposes another fulfillment marker`,
    );
  }
  assert.equal(expected.size, 0, `missing ProductShipment branches: ${[...expected].join(", ")}`);
}

function assertProductResponseSemantics() {
  assert.equal(
    schemas.Product.properties.custom_data.$ref,
    "#/components/schemas/NonEmptyCustomData",
  );
  const bindings = document.paths["/products/create"].post.responses["200"]
    .content["application/json"]["x-simile-from-request"].bindings;
  assert.equal(
    bindings.some((binding) =>
      ["/custom_data", "/shipment", "/shipment/type"].includes(binding.from)),
    false,
    "createProduct must not claim conditional product fields are unconditional echoes",
  );
}

function assertPurchaseIntentTargetUnion() {
  const intent = schemas.PurchaseIntent;
  assert.equal(intent.anyOf, undefined, "PurchaseIntent target alternatives must not permit both branches");
  assert.deepEqual(
    intent.oneOf.map((branch) => branch.required).sort(),
    [["bundle"], ["product"]],
  );
  const canceled = document.paths["/purchase_intents/cancel"].post.responses["200"]
    .content["application/json"].examples.canceled.value.purchase_intent;
  assert.equal(canceled.status, "inactive");
  assert.ok(canceled.inactive_at);
  assert.equal([canceled.product, canceled.bundle].filter(Boolean).length, 1);
  const updated = document.paths["/purchase_intents/update"].post.responses["200"]
    .content["application/json"].examples.updated.value.purchase_intent;
  assert.equal(updated.status, "active");
  assert.deepEqual(updated.quantity, { min: 2, max: 10 });
  assert.equal([updated.product, updated.bundle].filter(Boolean).length, 1);
  const found = document.paths["/purchase_intents/lookup"].post.responses["200"]
    .content["application/json"].examples.found.value.purchase_intent;
  assert.equal(found.status, "active");
  assert.equal([found.product, found.bundle].filter(Boolean).length, 1);
}

function assertOrderDeliveryResponses() {
  assert.deepEqual(
    new Set(schemas.OrderDocumentDeliveryResponse.required),
    new Set(["delivery", "order"]),
  );
  assert.equal(schemas.Order.properties.created_from.minProperties, 1);
  assert.equal(schemas.NonEmptyCustomData.minProperties, 1);
  assert.equal(schemas.OrderInvoiceSettingsResponse.minProperties, 1);
  assert.equal(
    schemas.Order.properties.custom_data.$ref,
    "#/components/schemas/NonEmptyCustomData",
  );
  assert.equal(
    schemas.Order.properties.invoice_settings.$ref,
    "#/components/schemas/OrderInvoiceSettingsResponse",
  );

  assertDocumentResponse("/orders/send_invoice", "200", "invoice", false, [
    "requires_payment", "paid", "completed", "canceled", "expired",
  ]);
  assertDocumentResponse("/orders/send_invoice", "207", "invoice", true, [
    "requires_payment", "paid", "completed", "canceled", "expired",
  ]);
  assertDocumentResponse("/orders/send_receipt", "200", "receipt", false, ["paid", "completed"]);
  assertDocumentResponse("/orders/send_receipt", "207", "receipt", true, ["paid", "completed"]);
  assertDocumentExample("/orders/send_invoice", "200", "invoice_sent", "invoice", false);
  assertDocumentExample("/orders/send_invoice", "207", "invoice_partially_sent", "invoice", true);
  assertDocumentExample("/orders/send_receipt", "200", "receipt_sent", "receipt", false);
  assertDocumentExample("/orders/send_receipt", "207", "receipt_partially_sent", "receipt", true);
}

function assertDocumentResponse(path, status, kind, partial, statuses) {
  const refinement = operationResponseRefinement(path, status);
  const delivery = objectRefinement(refinement.properties.delivery);
  const order = objectRefinement(refinement.properties.order);
  assert.deepEqual(delivery.properties.document_kind.enum, [kind]);
  assert.deepEqual(new Set(order.properties.status.enum), new Set(statuses));

  if (partial) {
    assert.equal(
      refinement.properties.delivery.allOf[0].$ref,
      "#/components/schemas/OrderDocumentPartialDelivery",
    );
    const partialDelivery = schemas.OrderDocumentPartialDelivery;
    for (const required of ["deliveries", "failed_channels", "failures", "sent_channels"]) {
      assert.ok(partialDelivery.required.includes(required));
      assert.equal(partialDelivery.properties[required].minItems, 1);
    }
    assert.ok(hasDisjointSet(partialDelivery, "/failed_channels", "/sent_channels"));
  } else {
    assert.equal(delivery.properties.deliveries.minItems, 1);
    assert.equal(delivery.properties.sent_channels.minItems, 1);
  }
}

function assertDocumentExample(path, status, name, kind, partial) {
  const example = document.paths[path].post.responses[status]
    .content["application/json"].examples[name].value;
  assert.equal(example.delivery.document_kind, kind);
  assert.ok(example.delivery.deliveries.length > 0);
  assert.ok(example.delivery.sent_channels.length > 0);
  assert.ok(example.order.id.startsWith("or_"));
  if (partial) {
    assert.ok(example.delivery.failed_channels.length > 0);
    assert.ok(example.delivery.failures.length > 0);
    assert.equal(
      example.delivery.sent_channels.some((channel) =>
        example.delivery.failed_channels.includes(channel)),
      false,
      `${path} ${status} example records one channel as both sent and failed`,
    );
  }
}

function assertPayoutLifecycleResponses() {
  const scheduled = objectRefinement(
    operationResponseRefinement("/payouts/schedule", "200").properties.payout,
  );
  assert.deepEqual(scheduled.properties.status.enum, ["scheduled"]);
  assert.ok(scheduled.required.includes("scheduled_at"));

  const canceled = objectRefinement(
    operationResponseRefinement("/payouts/cancel", "200").properties.payout,
  );
  assert.deepEqual(canceled.properties.status.enum, ["canceled"]);
  assert.ok(canceled.required.includes("canceled_at"));
  assert.ok(canceled.required.includes("cancellation"));
}

function assertBoundedSecretKeyPage() {
  const page = schemas.SecretKeyPage;
  assert.equal(page.properties.size.minimum, 1);
  assert.equal(page.properties.size.maximum, 100);
  assert.equal(page.properties.count.maximum, 100);
  assert.equal(page.properties.keys.maxItems, 100);
  assert.ok(hasBound(page, "/count", "/size"));
  assert.ok(hasBound(page, "/count", "/total"));
}

function operationResponseRefinement(path, status) {
  const schema = document.paths[path].post.responses[status].content["application/json"].schema;
  assert.ok(Array.isArray(schema.allOf), `${path} ${status} must refine its shared response`);
  const refinement = schema.allOf.find((candidate) => candidate.properties);
  assert.ok(refinement, `${path} ${status} has no operation-specific response refinement`);
  return refinement;
}

function objectRefinement(schema) {
  if (schema?.type === "object" || schema?.minProperties !== undefined) {
    return schema;
  }
  const refinement = schema?.allOf?.find((candidate) => candidate.type === "object");
  assert.ok(refinement, "expected an object refinement");
  return refinement;
}

function hasBound(schema, target, source) {
  return (schema["x-simile-constraints"] ?? []).some(
    (constraint) => constraint.bounded?.path === target && constraint.bounded.maximum?.path === source,
  );
}

function hasDisjointSet(schema, left, right) {
  return (schema["x-simile-constraints"] ?? []).some(
    (constraint) =>
      constraint.set?.left === left &&
      constraint.set?.right === right &&
      constraint.set?.relation === "disjoint",
  );
}
