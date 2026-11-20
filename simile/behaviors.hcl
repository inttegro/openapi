# Why: this config-local overlay lets `simile start` select exact outcomes through scenarios;
# integrators can exercise provider-authored public outcomes without publishing production
# decisions or duplicating their OpenAPI-owned bodies.
scenario "payment_method_tokenized" {
  description = "Return the reviewed mobile-money tokenization example."

  select "tokenizePaymentMethod" {
    outcome = "tokenized"
  }
}

scenario "purchase_intent_created" {
  description = "Return the reviewed active Buy-link example."

  select "createPurchaseIntent" {
    outcome = "created"
  }
}

scenario "chime_cooldown_active" {
  description = "Return the public Chime cooldown response."

  select "sendChime" {
    outcome = "cooldown_active"
  }
}

scenario "order_payment_method_invalid" {
  description = "Return the public invalid-payment-method order response."

  select "createOrder" {
    outcome = "payment_method_invalid"
  }
}

scenario "refund_currency_mismatch" {
  description = "Return the public refund currency-mismatch response."

  select "createRefund" {
    outcome = "currency_mismatch"
  }
}

scenario "payout_restricted" {
  description = "Return the public restricted-payout response."

  select "schedulePayout" {
    outcome = "payout_restricted"
  }
}

scenario "payment_method_invalid_body" {
  description = "Return the reviewed invalid tokenization-body response."

  select "tokenizePaymentMethod" {
    outcome = "malformed_body"
  }
}

scenario "product_gallery_too_large" {
  description = "Return the public oversized-product-gallery response."

  select "createProduct" {
    outcome = "gallery_too_large"
  }
}

scenario "purchase_intent_invalid_quantity_range" {
  description = "Return the public invalid Buy-link quantity-range response."

  select "createPurchaseIntent" {
    outcome = "invalid_quantity_range"
  }
}
