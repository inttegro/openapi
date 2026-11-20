# Why: transport faults are opt-in test controls, separate from domain outcomes. They exercise
# retry, timeout, and idempotency handling without randomly changing valid commerce decisions.
faults {
  use "http.slow" {
    as      = "integration_slow"
    latency = "2s"
  }

  use "http.response_lost" {}
}

scenario "slow_checkout_payment" {
  description = "Delay a completed checkout payment response by two seconds."

  inject "payCheckout" {
    fault = "integration_slow"
  }
}

scenario "slow_file_delivery" {
  description = "Delay public file-link delivery by two seconds."

  inject "openFileLink" {
    fault = "integration_slow"
  }
}

scenario "order_response_lost_after_commit" {
  description = "Commit order creation, then close delivery before the response arrives."

  inject "createOrder" {
    fault = "http.response_lost"
  }
}

scenario "refund_response_lost_after_commit" {
  description = "Commit refund creation, then close delivery before the response arrives."

  inject "createRefund" {
    fault = "http.response_lost"
  }
}

scenario "payout_response_lost_after_commit" {
  description = "Commit payout scheduling, then close delivery before the response arrives."

  inject "schedulePayout" {
    fault = "http.response_lost"
  }
}

fault_profile "slow_network" {
  description       = "Occasionally delay responses across the public API."
  probability       = 0.05
  faults            = ["integration_slow"]
  max_consecutive   = 1
  cooldown_requests = 10
  seed              = 4242
}

# Why: lost-response testing is limited to operations whose public contract documents safe replay
# through an idempotency key. The fixed seed makes CI failures exactly reproducible.
fault_profile "rough_idempotent_writes" {
  description = "Exercise bounded slow and lost responses on documented idempotent writes."
  probability = 0.02
  faults      = ["integration_slow", "http.response_lost"]
  operations = [
    "initiateOTP",
    "verifyOTP",
    "createOrder",
    "createRefund",
    "schedulePayout",
  ]
  max_consecutive   = 1
  cooldown_requests = 20
  seed              = 4242
}
