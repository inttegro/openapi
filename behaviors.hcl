# Why: `simile start` selects exact outcomes through scenarios, not `--outcome`; these opaque
# selectors let HTTP integrators exercise provider-authored public outcomes without publishing
# production decisions or duplicating their OpenAPI-owned bodies.
scenario "payment_method_tokenized" {
  select "tokenizePaymentMethod" {
    outcome = "tokenized"
  }
}

scenario "purchase_intent_created" {
  select "createPurchaseIntent" {
    outcome = "created"
  }
}

scenario "chime_cooldown_active" {
  select "sendChime" {
    outcome = "cooldown_active"
  }
}

scenario "order_payment_method_invalid" {
  select "createOrder" {
    outcome = "payment_method_invalid"
  }
}

scenario "refund_currency_mismatch" {
  select "createRefund" {
    outcome = "currency_mismatch"
  }
}

scenario "payout_restricted" {
  select "schedulePayout" {
    outcome = "payout_restricted"
  }
}

scenario "payment_method_invalid_body" {
  select "tokenizePaymentMethod" {
    outcome = "malformed_body"
  }
}

scenario "product_gallery_too_large" {
  select "createProduct" {
    outcome = "gallery_too_large"
  }
}

scenario "purchase_intent_invalid_quantity_range" {
  select "createPurchaseIntent" {
    outcome = "invalid_quantity_range"
  }
}
