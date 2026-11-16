import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptPath = fileURLToPath(import.meta.url);
const openapiDir = resolve(dirname(scriptPath), "..");

// This allow-list mirrors public serializers, not field-name guesses. Inputs
// that intentionally accept raw IDs and opaque/provider references stay out.
export const typedIdentifierPatterns = [
  // Censor resources.
  [["ChildrenPolicy", "properties", "id"], "cp"],
  [["OperatingPolicySelectionByID", "properties", "id"], "op"],
  [["TemplateOperatingPolicySource", "properties", "id"], "op"],
  [["OperatingPolicy", "properties", "id"], "op"],
  [["OperatingPolicy", "properties", "children_policy_id"], "cp"],
  [["LookupOperatingPolicyRequest", "properties", "operating_policy_id"], "op"],
  [["PageOperatingPolicyVersionsRequest", "properties", "operating_policy_id"], "op"],
  [["UpdateOperatingPolicyRequest", "properties", "operating_policy_id"], "op"],
  [["GeneratedSecretKey", "properties", "id"], "sk"],
  [["SecretKey", "properties", "id"], "sk"],
  [["SecretKeyUsageRow", "properties", "secret_key_id"], "sk"],
  [["CreateApplicationResponse", "properties", "app", "properties", "id"], "app"],
  [["CreateApplicationResponse", "properties", "app", "properties", "secret_key", "properties", "id"], "sk"],
  [["CreateApplicationResponse", "properties", "app", "properties", "relationship", "properties", "id"], "apprel"],
  [["CreateApplicationResponse", "properties", "app", "properties", "relationship", "properties", "parent", "properties", "id"], "app"],
  [["LookupApplicationResponse", "properties", "app", "properties", "id"], "app"],
  [["LookupApplicationResponse", "properties", "app", "properties", "relationship", "properties", "id"], "apprel"],
  [["LookupApplicationResponse", "properties", "app", "properties", "relationship", "properties", "parent", "properties", "id"], "app"],
  [["UpdateApplicationResponse", "properties", "app", "properties", "id"], "app"],

  // Octo files, links, and upload requests.
  [["FileObject", "properties", "id"], "file"],
  [["FileUploadReceipt", "properties", "id"], "file"],
  [["FileSource", "properties", "upload_request_id"], "uplreq"],
  [["FileLinkObject", "properties", "id"], "flink"],
  [["FileLinkObject", "properties", "file_id"], "file"],
  [["UploadRequestObject", "properties", "id"], "uplreq"],
  [["UploadRequestObject", "properties", "file_id"], "file"],
  [["UploadRequestAttempt", "properties", "id"], "uplatt"],
  [["UploadRequestAttempt", "properties", "upload_request_id"], "uplreq"],
  [["UploadRequestAttempt", "properties", "file_id"], "file"],
  [["UploadRequestReview", "properties", "file_id"], "file"],

  // Catalog and Buy-link resources.
  [["Customer", "properties", "id"], "cu"],
  [["FixedProductPriceSummary", "properties", "id"], "pr"],
  [["CustomerSelectedProductPriceSummary", "properties", "id"], "pr"],
  [["UpdatedProduct", "properties", "id"], "prod"],
  [["PurchaseIntent", "properties", "application_id"], "app"],
  [["PurchaseIntent", "properties", "id"], "sale"],
  [["PurchaseIntentBundleComponent", "properties", "price_id"], "pr"],
  [["PurchaseIntentBundleComponent", "properties", "product_id"], "prod"],
  [["PurchaseIntentBundle", "properties", "id"], "pbd"],
  [["PurchaseIntentPrice", "properties", "id"], "pr"],
  [["PurchaseIntentOriginalPrice", "properties", "id"], "pr"],
  [["PurchaseIntentProduct", "allOf", 1, "properties", "variant_set_id"], "pg"],
  [["PurchaseIntentUsageOrder", "properties", "id"], "or"],
  [["PurchaseIntentVariantSet", "properties", "default_product_id"], "prod"],
  [["PurchaseIntentVariantSet", "properties", "id"], "pg"],
  [["PurchaseIntentVariant", "properties", "product_id"], "prod"],
  [["PriceEmbeddedProduct", "properties", "id"], "prod"],
  [["FixedCatalogPrice", "properties", "id"], "pr"],
  [["FixedCatalogPrice", "properties", "product_id"], "prod"],
  [["CustomerSelectedCatalogPriceFields", "properties", "id"], "pr"],
  [["CustomerSelectedCatalogPriceFields", "properties", "product_id"], "prod"],
  [["Product", "properties", "id"], "prod"],

  // Orders, payments, and immutable line-item snapshots.
  [["CheckoutOrder", "properties", "id"], "or"],
  [["CheckoutOrder", "properties", "customer", "properties", "id"], "cu"],
  [["CheckoutOrder", "properties", "payment", "properties", "id"], "py"],
  [["OrderPaymentMethod", "properties", "id"], "pm"],
  [["OrderPaymentMethod", "properties", "customer_id"], "cu"],
  [["CheckoutInvoiceView", "properties", "id"], "or"],
  [["OrderPaymentAttempt", "properties", "payment_method_id"], "pm"],
  [["Order", "properties", "id"], "or"],
  [["Order", "properties", "customer", "properties", "id"], "cu"],
  [["Order", "properties", "payment", "properties", "id"], "py"],
  [["Order", "properties", "payment", "properties", "customer", "properties", "id"], "cu"],
  [["Order", "properties", "payment", "properties", "latest_attempt", "properties", "payment_method_id"], "pm"],
  [["Order", "properties", "payment", "properties", "payout_configuration", "properties", "destination", "properties", "financial_account_id"], "fa"],
  [["OrderProductLineItem", "properties", "product", "properties", "id"], "oli"],
  [["OrderProductLineItem", "properties", "product", "properties", "product_id"], "prod"],
  [["OrderProductLineItem", "properties", "product", "properties", "price_id"], "pr"],
  [["OrderFeeLineItem", "properties", "fee", "properties", "id"], "oli"],
  [["OrderShippingLineItem", "properties", "shipping", "properties", "id"], "oli"],

  // Refund and balance-ledger resources.
  [["RefundSettlementMobileMoneyPaymentMethod", "properties", "id"], "pm"],
  [["RefundSettlementBankAccountPaymentMethod", "properties", "id"], "pm"],
  [["RefundLineItem", "properties", "id"], "rli"],
  [["RefundLineItem", "properties", "order_line_item_id"], "oli"],
  [["RefundOrderProductLineItem", "properties", "id"], "oli"],
  [["RefundOrderProductLineItem", "properties", "product", "properties", "id"], "prod"],
  [["RefundOrderFeeLineItem", "properties", "id"], "oli"],
  [["RefundOrderShippingLineItem", "properties", "id"], "oli"],
  [["Refund", "properties", "id"], "rf"],
  [["Refund", "properties", "order_id"], "or"],
  [["BalanceTransactionAllocationBase", "properties", "id"], "bta"],
  [["BalanceTransactionRefundAllocation", "properties", "id"], "bta"],
  [["BalanceTransactionRefundAllocation", "properties", "refund", "properties", "id"], "rf"],
  [["BalanceTransactionPayoutAllocation", "properties", "id"], "bta"],
  [["BalanceTransactionPayoutAllocation", "properties", "payout", "properties", "id"], "po"],
  [["BalanceTransactionBase", "properties", "id"], "bt"],
  [["PaymentBalanceTransaction", "properties", "id"], "bt"],
  [["PaymentBalanceTransaction", "properties", "order_id"], "or"],
  [["PaymentBalanceTransaction", "properties", "payment_id"], "py"],
  [["PaymentBalanceTransaction", "properties", "payout_id"], "po"],
  [["PaymentBalanceTransaction", "properties", "payout_configuration", "properties", "destination", "properties", "financial_account_id"], "fa"],
  [["RefundBalanceTransaction", "properties", "id"], "bt"],
  [["RefundBalanceTransaction", "properties", "order_id"], "or"],
  [["RefundBalanceTransaction", "properties", "refund_id"], "rf"],
  [["PayoutDebitBalanceTransaction", "properties", "id"], "bt"],
  [["PayoutDebitBalanceTransaction", "properties", "payout_id"], "po"],

  // Financial accounts, payouts, and payment methods.
  [["FinancialAccountCommonResponse", "properties", "id"], "fa"],
  [["FinancialAccountCompactResponse", "properties", "id"], "fa"],
  [["FinancialAccountMandate", "properties", "id"], "fm"],
  [["PayoutBalanceTransaction", "properties", "id"], "bt"],
  [["Payout", "properties", "balance_transaction_id"], "bt"],
  [["Payout", "properties", "destination_id"], "fa"],
  [["Payout", "properties", "id"], "po"],
  [["Payout", "properties", "schedule_id"], "posc"],
  [["PayoutSettingsLookupScheduleAgingSpec", "properties", "public_id"], "bt_aging_spec"],
  [["PayoutSettingsMutationScheduleSpec", "properties", "public_id"], "bt_aging_spec"],
  [["PaymentMethodObject", "properties", "customer_id"], "cu"],
  [["PaymentMethodObject", "properties", "id"], "pm"],

  // Mercurio messages and OTP resources.
  [["MessageTemplate", "properties", "id"], "mtpl"],
  [["OrderDocumentDeliveryAttempt", "properties", "chime_id"], "ch"],
  [["Chime", "properties", "customer_id"], "cu"],
  [["Chime", "properties", "id"], "ch"],
  [["ScheduleCreationDetail", "properties", "id"], "sch"],
  [["ScheduleDetail", "properties", "id"], "sch"],
  [["BroadcastCreationDetail", "properties", "id"], "brc"],
  [["BroadcastDetail", "properties", "id"], "brc"],
  [["OTPTransaction", "properties", "id"], "ot"],
  [["OTPVerificationAttempt", "properties", "id"], "ov"],
];

export function checkTypedIdentifierPatterns(document) {
  const checked = new Set();
  for (const [relativePath, prefix] of typedIdentifierPatterns) {
    const path = ["components", "schemas", ...relativePath];
    const schema = readAt(document, path);
    const expected = `^${prefix}_`;
    assert.ok(!checked.has(label(path)), `${label(path)} is listed more than once`);
    checked.add(label(path));
    assert.equal(schema.type, "string", `${label(path)} must remain a string`);
    assert.equal(schema.pattern, expected, `${label(path)} must declare ${expected}`);

    // Exercise one matching and one cross-resource value so a weakened or
    // unanchored pattern cannot silently pass the inventory check.
    const pattern = new RegExp(schema.pattern);
    assert.ok(pattern.test(`${prefix}_example`), `${label(path)} rejects its typed ID`);
    assert.ok(!pattern.test(`wrong_${prefix}_example`), `${label(path)} accepts a wrong type prefix`);
    if (typeof schema.example === "string") {
      assert.ok(pattern.test(schema.example), `${label(path)} has an example outside ${expected}`);
    }
  }
}

function readAt(document, path) {
  let current = document;
  for (const segment of path) {
    current = current?.[segment];
    assert.notEqual(current, undefined, `${label(path)} does not resolve`);
  }
  return current;
}

function label(path) {
  return `/${path.map((segment) => String(segment).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const document = YAML.parse(readFileSync(resolve(openapiDir, "commerce.yml"), "utf8"));
  checkTypedIdentifierPatterns(document);
  console.log(`Typed ID patterns verified: ${typedIdentifierPatterns.length} public typed-ID fields`);
}
