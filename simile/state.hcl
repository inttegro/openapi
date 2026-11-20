# Public response snapshots make successful mutations inspectable in local integration tests.
backend "db" "resources" {
  description = "Emulator-owned snapshots of public resources created or changed during a test."
}

# Singleton configuration is retained independently from resource snapshots.
backend "db" "configuration" {
  description = "Emulator-owned snapshots of singleton public service configuration."
}

backend "queue" "work" {
  description = "Publicly observable work that continues after an accepted request."
}

backend "scheduler" "work" {
  description = "Future public work accepted by scheduling operations."
}

async "process_broadcast" {
  description = "Process an accepted asynchronous Chime broadcast."

  action "queue.work" "publish" {
    body = response.broadcast
  }
}

async "process_refund" {
  description = "Advance an accepted refund from its initial pending state."

  action "queue.work" "publish" {
    body = response.refund
  }
}

async "cleanup_file" {
  description = "Clean up file contents after a file has been tombstoned."

  action "queue.work" "publish" {
    body = response.file
  }
}

# Why: lookup and page operations expose these resources after mutation, so successful writes keep
# the complete public response snapshot in one abstract database. Error outcomes have no matching
# response projection and therefore do not commit an effect.
effect "initiate_otp" {
  description = "Record the public OTP transaction returned by initiation."
  operations  = ["initiateOTP"]

  action "db.resources" "put" {
    collection = "otp_transactions"
    key        = response.transaction.id
    value      = response.transaction
  }
}

effect "verify_otp" {
  description = "Record the latest public OTP transaction after verification."
  operations  = ["verifyOTP"]

  action "db.resources" "put" {
    collection = "otp_transactions"
    key        = response.transaction.id
    value      = response.transaction
  }
}

effect "send_chime" {
  description = "Record the Chime returned by an immediate send."
  operations  = ["sendChime"]

  action "db.resources" "put" {
    collection = "chimes"
    key        = response.chime.id
    value      = response.chime
  }
}

effect "schedule_chime" {
  description = "Record a scheduled Chime and register its future delivery."
  operations  = ["scheduleChime"]

  action "db.resources" "put" {
    collection = "scheduled_chimes"
    key        = response.scheduled_chime.id
    value      = response.scheduled_chime
  }

  action "scheduler.work" "schedule" {
    id      = response.scheduled_chime.id
    due_at  = response.scheduled_chime.send_after
    payload = response.scheduled_chime
  }
}

effect "cancel_scheduled_chime" {
  description = "Record a canceled Chime schedule and cancel its future delivery."
  operations  = ["cancelSchedule"]

  action "db.resources" "put" {
    collection = "scheduled_chimes"
    key        = response.scheduled_chime.id
    value      = response.scheduled_chime
  }

  action "scheduler.work" "cancel" {
    id = response.scheduled_chime.id
  }
}

effect "start_broadcast" {
  description = "Record and process an accepted asynchronous Chime broadcast."
  operations  = ["broadcastChime"]
  async       = ["process_broadcast"]

  action "db.resources" "put" {
    collection = "broadcasts"
    key        = response.broadcast.id
    value      = response.broadcast
  }
}

effect "cancel_broadcast" {
  description = "Record the latest public state of a canceled Chime broadcast."
  operations  = ["cancelBroadcast"]

  action "db.resources" "put" {
    collection = "broadcasts"
    key        = response.broadcast.id
    value      = response.broadcast
  }
}

effect "mutate_message_template" {
  description = "Record the latest public message-template version and lifecycle state."
  operations = [
    "createMessageTemplate",
    "updateMessageTemplate",
    "publishMessageTemplate",
    "archiveMessageTemplate",
  ]

  action "db.resources" "put" {
    collection = "message_templates"
    key        = response.message_template.id
    value      = response.message_template
  }
}

effect "mutate_customer" {
  description = "Record a created or updated customer profile."
  operations  = ["createCustomer", "updateCustomer"]

  action "db.resources" "put" {
    collection = "customers"
    key        = response.customer.id
    value      = response.customer
  }
}

effect "mutate_order" {
  description = "Record the latest public order snapshot after an order or checkout transition."
  operations = [
    "selectCheckoutAmount",
    "payCheckout",
    "confirmCheckoutPayment",
    "requestCheckoutConfirmation",
    "createOrder",
    "updateOrder",
    "payOrder",
    "confirmPayment",
    "requestConfirmation",
    "cancelOrder",
    "finalizeOrder",
    "completeOrder",
  ]

  action "db.resources" "put" {
    collection = "orders"
    key        = response.order.id
    value      = response.order
  }
}

effect "create_refund" {
  description = "Record a pending refund and dispatch its documented asynchronous processing."
  operations  = ["createRefund"]
  async       = ["process_refund"]

  action "db.resources" "put" {
    collection = "refunds"
    key        = response.refund.id
    value      = response.refund
  }
}

effect "cancel_refund" {
  description = "Record the latest public state of a canceled refund."
  operations  = ["cancelRefund"]

  action "db.resources" "put" {
    collection = "refunds"
    key        = response.refund.id
    value      = response.refund
  }
}

effect "mutate_application" {
  description = "Record a created or updated application snapshot."
  operations  = ["createApplication", "updateApplication"]

  action "db.resources" "put" {
    collection = "applications"
    key        = response.app.id
    value      = response.app
  }
}

effect "mutate_operating_policy" {
  description = "Record the active immutable operating-policy version."
  operations  = ["createOperatingPolicy", "updateOperatingPolicy"]

  action "db.resources" "put" {
    collection = "operating_policies"
    key        = response.operating_policy.id
    value      = response.operating_policy
  }
}

effect "mutate_secret_key" {
  description = "Record the public secret-key lifecycle snapshot returned by a mutation."
  operations  = ["generateSecretKey", "updateSecretKey", "destroySecretKey"]

  action "db.resources" "put" {
    collection = "secret_keys"
    key        = response.key.id
    value      = response.key
  }
}

effect "mutate_financial_account" {
  description = "Record the latest public financial-account capability and connection state."
  operations = [
    "createFinancialAccount",
    "connectFinancialAccount",
    "updateFinancialAccount",
    "enableFinancialAccountPush",
    "disableFinancialAccountPush",
    "disconnectFinancialAccount",
    "reconnectFinancialAccount",
    "enableFinancialAccountPull",
    "disableFinancialAccountPull",
  ]

  action "db.resources" "put" {
    collection = "financial_accounts"
    key        = response.account.id
    value      = response.account
  }
}

effect "schedule_payout" {
  description = "Record a scheduled payout and register its public execution time."
  operations  = ["schedulePayout"]

  action "db.resources" "put" {
    collection = "payouts"
    key        = response.payout.id
    value      = response.payout
  }

  action "scheduler.work" "schedule" {
    id      = response.payout.id
    due_at  = response.payout.execute_after
    payload = response.payout
  }
}

effect "cancel_payout" {
  description = "Record a canceled payout and cancel its scheduled execution."
  operations  = ["cancelPayout"]

  action "db.resources" "put" {
    collection = "payouts"
    key        = response.payout.id
    value      = response.payout
  }

  action "scheduler.work" "cancel" {
    id = response.payout.id
  }
}

effect "mutate_payout_settings" {
  description = "Record the latest public payout settings snapshot."
  operations  = ["setPayoutDestinations", "disableAutomaticPayouts", "enableAutomaticPayouts"]

  action "db.configuration" "put" {
    collection = "payout_settings"
    key        = "current"
    value      = response.settings
  }
}

effect "create_file" {
  description = "Record the public metadata for a created file."
  operations  = ["createFile"]

  action "db.resources" "put" {
    collection = "files"
    key        = response.file.id
    value      = response.file
  }
}

effect "delete_file" {
  description = "Record a tombstoned file and dispatch its documented content cleanup."
  operations  = ["deleteFile"]
  async       = ["cleanup_file"]

  action "db.resources" "put" {
    collection = "files"
    key        = response.file.id
    value      = response.file
  }
}

effect "create_file_link" {
  description = "Record a newly created public file-link capability."
  operations  = ["createFileLink"]

  action "db.resources" "put" {
    collection = "file_links"
    key        = response.file_link.id
    value      = response.file_link
  }
}

effect "revoke_file_link" {
  description = "Record the latest public state of a revoked file-link capability."
  operations  = ["revokeFileLink"]

  action "db.resources" "put" {
    collection = "file_links"
    key        = response.file_link.id
    value      = response.file_link
  }
}

effect "mutate_upload_request" {
  description = "Record a delegated upload request after creation, cancellation, or review."
  operations  = ["createUploadRequest", "cancelUploadRequest", "reviewUploadRequestAttempt"]

  action "db.resources" "put" {
    collection = "upload_requests"
    key        = response.upload_request.id
    value      = response.upload_request
  }
}

effect "fulfill_upload_request" {
  description = "Record the fulfilled upload request and the public metadata of its file."
  operations  = ["fulfillUploadRequest"]

  action "db.resources" "put" {
    collection = "upload_requests"
    key        = response.upload_request.id
    value      = response.upload_request
  }

  action "db.resources" "put" {
    collection = "files"
    key        = response.file.id
    value      = response.file
  }
}

effect "mutate_payment_method" {
  description = "Record the latest public payment-method lifecycle snapshot."
  operations = [
    "tokenizePaymentMethod",
    "updatePaymentMethod",
    "activatePaymentMethod",
    "disactivatePaymentMethod",
    "archivePaymentMethod",
    "unarchivePaymentMethod",
  ]

  action "db.resources" "put" {
    collection = "payment_methods"
    key        = response.payment_method.id
    value      = response.payment_method
  }
}

effect "mutate_product" {
  description = "Record the latest public product catalog snapshot."
  operations  = ["createProduct", "updateProduct", "publishProduct", "unpublishProduct", "archiveProduct"]

  action "db.resources" "put" {
    collection = "products"
    key        = response.product.id
    value      = response.product
  }
}

effect "mutate_price" {
  description = "Record a created or changed public catalog price."
  operations  = ["addProductPrice", "createPrice", "updatePrice", "activatePrice", "deactivatePrice", "archivePrice"]

  action "db.resources" "put" {
    collection = "prices"
    key        = response.price.id
    value      = response.price
  }
}

effect "mutate_purchase_intent" {
  description = "Record the latest public Buy-link lifecycle snapshot."
  operations  = ["createPurchaseIntent", "updatePurchaseIntent", "cancelPurchaseIntent"]

  action "db.resources" "put" {
    collection = "purchase_intents"
    key        = response.purchase_intent.id
    value      = response.purchase_intent
  }
}
