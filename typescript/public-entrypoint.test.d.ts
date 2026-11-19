import type {
  BalanceTransactionAllocationBase,
  Input,
  Operations,
  OperationResult,
  SchemaSoundness,
} from "./commerce";
import type { Assert, Equal } from "./proof-kernel";

// Why: commerce.d.ts is the stable public entrypoint even though its generated
// declarations are split across modules for review and editor performance.
type _PublicModelExport = Assert<
  Equal<BalanceTransactionAllocationBase["id"], `bta_${string}`>
>;
type _PublicInputExport = Assert<
  Equal<
    Operations["createOrder"]["request"]["content"]["application/json"],
    Input.CreateOrderRequest
  >
>;
type _PublicOperationExport = Assert<
  Equal<Operations["createOrder"]["method"], "POST">
>;
type _PublicResultExport = Assert<
  OperationResult<"createOrder"> extends { readonly status: number }
    ? true
    : false
>;
type _PublicSoundnessExport = Assert<
  SchemaSoundness["BalanceTransactionAllocationBase"] extends readonly unknown[]
    ? true
    : false
>;
