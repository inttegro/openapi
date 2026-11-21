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
  ["pageSecretKeys", "page aliases, zero defaults, and the upper size cap require a conditional numeric transform"],
  ["createFile", "Simile does not currently compile request-response relations for multipart bodies"],
  ["streamFileContents", "the success payload is an application/octet-stream transport body"],
  ["openFileLink", "the success payload is an application/octet-stream transport body or redirect"],
  ["fulfillUploadRequest", "Simile does not currently compile request-response relations for multipart bodies"],
  ["getPaymentMethodSettings", "the empty request returns authentication-scoped payment settings"],
  ["createPurchaseIntent", "Simile cannot yet combine target-preserving relations with the public product-or-bundle response union"],
  ["listCountrySpecs", "the empty request returns static public country specifications"],
]);
