# Why: lifecycle fixtures let integrations exercise authenticated, revoked, and expired callers
# deterministically with credentials that exist only inside the local Simile service.
principal "application" {
  description = "An application that calls the Inttegro Commerce API."

  credential "bearerAuth" {}
}

profile "local_application" {
  description = "An active application for authenticated integration tests."
  principal   = principal.application

  credential "bearerAuth" {
    value = "simile_test_active"
  }
}

profile "revoked_application" {
  description = "An application with a revoked bearer credential."
  principal   = principal.application
  status      = "revoked"

  credential "bearerAuth" {
    value = "simile_test_revoked"
  }
}

profile "expired_application" {
  description = "An application with an expired bearer credential."
  principal   = principal.application
  status      = "expired"

  credential "bearerAuth" {
    value = "simile_test_expired"
  }
}
