# Why: these provider-authored outcomes expose high-value public failure modes with their exact
# operation-specific status and error tuple. Opaque scenarios select them without publishing the
# private production conditions that cause the same observable result.

behavior "verifyOTP" {
  description = "Expose reviewed OTP lifecycle failures for integration tests."

  outcome "otp_transaction_expired" {
    description = "The OTP transaction expired before verification."
    status      = 422
    body = {
      error = {
	cause    = "precondition_unmet"
	code     = "otp_transaction_expired"
	fix_code = "satisfy_precondition"
	type     = "bad_request"
	url      = "https://studio.inttegro.com/errors"
      }
    }
  }

  outcome "otp_max_verification_attempts_exceeded" {
    description = "The OTP transaction has no verification attempts remaining."
    status      = 422
    body = {
      error = {
	cause    = "precondition_unmet"
	code     = "otp_max_verification_attempts_exceeded"
	fix_code = "satisfy_precondition"
	type     = "bad_request"
	url      = "https://studio.inttegro.com/errors"
      }
    }
  }
}

behavior "lookupCustomer" {
  outcome "customer_not_found" {
    description = "No customer matches the supplied public identifier."
    status      = 404
    body = {
      cause    = "invalid_request_parameter"
      code     = "customer_not_found"
      fix_code = "change_request_parameters"
      type     = "invalid_request_parameter"
      url      = "https://studio.inttegro.com/errors"
    }
  }
}

behavior "lookupOrder" {
  outcome "order_not_found" {
    description = "No order matches the supplied public identifier."
    status      = 400
    body = {
      cause    = "invalid_request_parameter"
      code     = "order_not_found"
      fix_code = "change_request_parameters"
      type     = "invalid_request_parameter"
      url      = "https://studio.inttegro.com/errors"
    }
  }
}

behavior "lookupProduct" {
  outcome "product_not_found" {
    description = "No product matches the supplied public identifier."
    status      = 422
    body = {
      cause    = "invalid_request_parameter"
      code     = "product_not_found"
      fix_code = "change_request_parameters"
      type     = "invalid_request_parameter"
      url      = "https://studio.inttegro.com/errors"
    }
  }
}

behavior "lookupPurchaseIntent" {
  outcome "purchase_intent_not_found" {
    description = "The Buy link is unavailable through public lookup."
    status      = 404
    body = {
      cause    = "invalid_request_parameter"
      code     = "purchase_intent_not_found"
      fix_code = "change_request_parameters"
      type     = "invalid_request_parameter"
      url      = "https://studio.inttegro.com/errors"
    }
  }
}

behavior "lookupPaymentMethod" {
  outcome "payment_method_not_found" {
    description = "No payment method matches the supplied public identifier."
    status      = 404
    body = {
      cause    = "invalid_request_parameter"
      code     = "payment_method_not_found"
      fix_code = "change_request_parameters"
      type     = "invalid_request_parameter"
      url      = "https://studio.inttegro.com/errors"
    }
  }
}

behavior "createRefund" {
  outcome "refund_insufficient_merchant_balance" {
    description = "The merchant balance cannot currently fund the refund."
    status      = 400
    body = {
      error = {
	cause    = "precondition_unmet"
	code     = "refund_insufficient_merchant_balance"
	fix_code = "satisfy_precondition"
	type     = "bad_request"
	url      = "https://studio.inttegro.com/errors"
      }
    }
  }
}

behavior "cancelRefund" {
  outcome "refund_not_found" {
    description = "No refund matches the supplied public identifier."
    status      = 404
    body = {
      error = {
	cause    = "invalid_request_parameter"
	code     = "refund_not_found"
	fix_code = "change_request_parameters"
	type     = "invalid_request_parameter"
	url      = "https://studio.inttegro.com/errors"
      }
    }
  }

  outcome "refund_cannot_cancel" {
    description = "The refund is no longer in a cancelable lifecycle state."
    status      = 409
    body = {
      error = {
	cause    = "resource_state_conflict"
	code     = "refund_cannot_cancel"
	fix_code = "refresh_resource_state"
	type     = "state_conflict"
	url      = "https://studio.inttegro.com/errors"
      }
    }
  }
}

behavior "completeOrder" {
  outcome "order_payment_not_paid" {
    description = "The order cannot complete before its payment succeeds."
    status      = 400
    body = {
      cause    = "precondition_unmet"
      code     = "order_payment_not_paid"
      fix_code = "satisfy_precondition"
      type     = "bad_request"
      url      = "https://studio.inttegro.com/errors"
    }
  }
}

behavior "confirmPayment" {
  outcome "confirmation_bad_token" {
    description = "The submitted customer confirmation token is invalid."
    status      = 400
    body = {
      error = {
	cause    = "invalid_request_parameter"
	code     = "confirmation_bad_token"
	fix_code = "change_request_parameters"
	type     = "invalid_request_parameter"
	url      = "https://studio.inttegro.com/errors"
      }
    }
  }

  outcome "payment_transition_conflict" {
    description = "Another payment transition won the lifecycle race."
    status      = 409
    body = {
      error = {
	cause    = "resource_state_conflict"
	code     = "payment_transition_conflict"
	fix_code = "refresh_resource_state"
	type     = "state_conflict"
	url      = "https://studio.inttegro.com/e/payment_transition_conflict"
      }
    }
  }
}

behavior "lookupFile" {
  outcome "file_not_found" {
    description = "No file matches the supplied public identifier."
    status      = 404
    body = {
      cause    = "resource_not_found"
      code     = "file_not_found"
      fix_code = "refresh_resource_state"
      type     = "not_found"
      url      = "https://studio.inttegro.com/errors"
    }
  }
}

behavior "openFileLink" {
  outcome "file_link_expired" {
    description = "The public file-link capability has expired."
    status      = 410
    body = {
      cause    = "resource_state_invalid"
      code     = "file_link_expired"
      fix_code = "refresh_resource_state"
      type     = "state_invalid"
      url      = "https://studio.inttegro.com/errors"
    }
  }
}

behavior "lookupUploadRequest" {
  outcome "upload_request_not_found" {
    description = "No delegated upload request matches the supplied identifier."
    status      = 404
    body = {
      cause    = "resource_not_found"
      code     = "upload_request_not_found"
      fix_code = "refresh_resource_state"
      type     = "not_found"
      url      = "https://studio.inttegro.com/errors"
    }
  }
}

behavior "fulfillUploadRequest" {
  outcome "upload_request_expired" {
    description = "The delegated upload request expired before fulfillment."
    status      = 410
    body = {
      cause    = "resource_state_invalid"
      code     = "upload_request_expired"
      fix_code = "refresh_resource_state"
      type     = "state_invalid"
      url      = "https://studio.inttegro.com/errors"
    }
  }
}

behavior "activatePrice" {
  outcome "price_archived" {
    description = "An archived price cannot be activated."
    status      = 422
    body = {
      cause    = "precondition_unmet"
      code     = "price_archived"
      fix_code = "satisfy_precondition"
      type     = "bad_request"
      url      = "https://studio.inttegro.com/errors"
    }
  }
}

behavior "archiveProduct" {
  outcome "product_already_archived" {
    description = "The product is already archived."
    status      = 422
    body = {
      cause    = "precondition_unmet"
      code     = "product_already_archived"
      fix_code = "satisfy_precondition"
      type     = "bad_request"
      url      = "https://studio.inttegro.com/errors"
    }
  }
}

scenario "otp_expired" {
  description = "Exercise verification after OTP expiry."
  select "verifyOTP" { outcome = "otp_transaction_expired" }
}

scenario "otp_attempts_exhausted" {
  description = "Exercise verification after all OTP attempts are used."
  select "verifyOTP" { outcome = "otp_max_verification_attempts_exceeded" }
}

scenario "customer_not_found" {
  description = "Exercise customer lookup for an unavailable identifier."
  select "lookupCustomer" { outcome = "customer_not_found" }
}

scenario "order_not_found" {
  description = "Exercise order lookup for an unavailable identifier."
  select "lookupOrder" { outcome = "order_not_found" }
}

scenario "product_not_found" {
  description = "Exercise product lookup for an unavailable identifier."
  select "lookupProduct" { outcome = "product_not_found" }
}

scenario "purchase_intent_not_found" {
  description = "Exercise public Buy-link lookup for an unavailable offer."
  select "lookupPurchaseIntent" { outcome = "purchase_intent_not_found" }
}

scenario "payment_method_not_found" {
  description = "Exercise payment-method lookup for an unavailable identifier."
  select "lookupPaymentMethod" { outcome = "payment_method_not_found" }
}

scenario "refund_insufficient_balance" {
  description = "Exercise refund creation when the merchant balance cannot fund it."
  select "createRefund" { outcome = "refund_insufficient_merchant_balance" }
}

scenario "refund_not_found" {
  description = "Exercise refund cancellation for an unavailable identifier."
  select "cancelRefund" { outcome = "refund_not_found" }
}

scenario "refund_cannot_cancel" {
  description = "Exercise refund cancellation after the cancelable lifecycle window."
  select "cancelRefund" { outcome = "refund_cannot_cancel" }
}

scenario "order_payment_not_paid" {
  description = "Exercise order completion before payment succeeds."
  select "completeOrder" { outcome = "order_payment_not_paid" }
}

scenario "confirmation_bad_token" {
  description = "Exercise payment confirmation with an invalid token."
  select "confirmPayment" { outcome = "confirmation_bad_token" }
}

scenario "payment_transition_conflict" {
  description = "Exercise a conflicting concurrent payment transition."
  select "confirmPayment" { outcome = "payment_transition_conflict" }
}

scenario "file_not_found" {
  description = "Exercise file lookup for an unavailable identifier."
  select "lookupFile" { outcome = "file_not_found" }
}

scenario "file_link_expired" {
  description = "Exercise an expired public file-link capability."
  select "openFileLink" { outcome = "file_link_expired" }
}

scenario "upload_request_not_found" {
  description = "Exercise delegated-upload lookup for an unavailable identifier."
  select "lookupUploadRequest" { outcome = "upload_request_not_found" }
}

scenario "upload_request_expired" {
  description = "Exercise fulfillment after a delegated upload expires."
  select "fulfillUploadRequest" { outcome = "upload_request_expired" }
}

scenario "price_archived" {
  description = "Exercise activation of an archived catalog price."
  select "activatePrice" { outcome = "price_archived" }
}

scenario "product_already_archived" {
  description = "Exercise repeated product archival."
  select "archiveProduct" { outcome = "product_already_archived" }
}
