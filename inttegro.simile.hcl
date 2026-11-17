service "inttegro" {
  listen {
    host = "127.0.0.1"
    port = 4242
  }

  openapi {
    path = "./commerce.yml"
  }

  # Why: the module contains only opaque selectors for exact OpenAPI examples; routes, schemas,
  # statuses, and response bodies remain owned by the public OpenAPI contract.
  behaviors = [
    "./behaviors.hcl",
  ]
}
