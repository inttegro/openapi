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
    "./behaviors.hcl",
    "./errors.hcl",
    "./state.hcl",
    "./faults.hcl",
  ]
}
