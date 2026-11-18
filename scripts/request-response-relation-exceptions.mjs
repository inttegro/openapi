// Why: these operations have no truthful request-controlled JSON relationship that the current
// Simile grammar can construct. Keeping one shared, exact inventory prevents the validator and
// published coverage report from drifting or silently calling schema-only synthesis reachable.
export const relationExceptions = new Map([
  ["lookupChimeSettings", "the empty request selects authentication-scoped settings"],
  ["lookupApplicationCapabilities", "the empty request returns authentication-scoped capabilities"],
  ["lookupApplication", "the empty request returns the authenticated application"],
  ["lookupBalances", "the empty request returns authentication-scoped balances"],
  ["getPayoutSettings", "the empty request returns authentication-scoped payout settings"],
  ["enableAutomaticPayouts", "the empty request enables server-configured automatic payout settings"],
  ["schedulePayout", "Simile cannot yet construct the lifecycle-constrained payout while preserving caller-selected values"],
  ["lookupPayout", "Simile cannot yet construct the lifecycle-constrained payout while preserving its selected ID"],
  ["cancelPayout", "Simile cannot yet construct the canceled payout while preserving its selected ID"],
  ["pageSecretKeys", "page aliases, zero defaults, and the upper size cap require a conditional numeric transform"],
  ["sendOrderInvoice", "Simile cannot yet construct the constrained delivery envelope while preserving the selected order ID"],
  ["sendOrderReceipt", "Simile cannot yet construct the constrained delivery envelope while preserving the selected order ID"],
  ["createFile", "Simile does not currently compile request-response relations for multipart bodies"],
  ["streamFileContents", "the success payload is an application/octet-stream transport body"],
  ["openFileLink", "the success payload is an application/octet-stream transport body or redirect"],
  ["fulfillUploadRequest", "Simile does not currently compile request-response relations for multipart bodies"],
  ["getPaymentMethodSettings", "the empty request returns authentication-scoped payment settings"],
  ["tokenizePaymentMethod", "masking and last-four derivation require a substring transform not supported by the relation language"],
  ["createPurchaseIntent", "Simile cannot yet combine target-preserving relations with the public product-or-bundle response union"],
  ["updatePurchaseIntent", "Simile cannot yet combine mutation-preserving relations with the public product-or-bundle response union"],
  ["cancelPurchaseIntent", "Simile cannot yet preserve the selected ID and canceled state through the public target union"],
  ["lookupPurchaseIntent", "Simile cannot yet preserve the selected ID through the public product-or-bundle response union"],
  ["pagePurchaseIntents", "Simile relation-mode synthesis cannot yet construct pages containing the public target union"],
  ["listCountrySpecs", "the empty request returns static public country specifications"],
]);
