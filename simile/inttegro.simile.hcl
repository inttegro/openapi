service "inttegro" {
  description = "A public-contract emulator for building and testing Inttegro Commerce integrations."

  listen {
    host = "127.0.0.1"
    port = 4242
  }

  openapi {
    path = "../commerce.yml"
  }

  # Why: each module exposes one independently reviewable class of public test behavior while
  # routes, schemas, statuses, and wire payloads remain owned by the public OpenAPI contract.
  behaviors = [
    "./principals.hcl",
    "./behaviors.hcl",
    "./errors.hcl",
    "./state.hcl",
    "./faults.hcl",
  ]
}

# Why: this workflow makes the public application-creation path usable as local integration setup
# while the issued bearer credential remains synthetic and confined to the generated profile.
principal_setup "application" {
  description = "Create a local Inttegro application identity for an integration."
  operation   = "createApplication"

  collect "name" {
    description = "A name that identifies the integration."
    required    = true
    to          = request.name
  }

  collect "alias" {
    description = "An optional short name for the integration."
    to          = request.alias
  }

  collect "description" {
    description = "An optional description of the integration."
    to          = request.description
  }

  issue "application_id" {
    description = "The local application identifier."
    from        = response.app.id
  }

  issue "api_key" {
    description = "The local bearer credential used to authenticate API requests."
    generate    = "token"
    prefix      = "simile_test_"
    credential  = "bearerAuth"
    sensitive   = true
  }
}
