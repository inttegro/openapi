import type {
  OperationExamples,
  RequestBody,
  ResponseBody,
  ResponseRelation,
} from "./contract-ir";
import type {
  Assert,
  RelationHolds,
  SetPath,
} from "./proof-kernel";

type CreateOrderRequest =
  OperationExamples["createOrder"]["request"]["finalized_requires_payment"];
type CreateOrderResponse =
  OperationExamples["createOrder"]["responses"]["200"]["requires_payment"];
type CreateOrderRelation = ResponseRelation<
  "createOrder",
  "200",
  "application/json"
>;

// Why: these assertions make the public examples compile-time witnesses for
// both the declared HTTP payloads and the request-to-response relationship.
type _RequestMatchesContract = Assert<
  CreateOrderRequest extends RequestBody<"createOrder", "application/json">
    ? true
    : false
>;
type _ResponseMatchesContract = Assert<
  CreateOrderResponse extends ResponseBody<
    "createOrder",
    "200",
    "application/json"
  >
    ? true
    : false
>;
type _SoundCreateOrderScenario = Assert<
  RelationHolds<CreateOrderRequest, CreateOrderResponse, CreateOrderRelation>
>;

type WrongTotal = SetPath<
  CreateOrderResponse,
  "/order/line_item_group/total/value",
  19999
>;
// Why: an order total that does not equal the request line-item calculation
// must fail as a proof witness even though every field remains well-typed.
type _RejectWrongTotal = Assert<
  // @ts-expect-error the request computes a total of 20000
  RelationHolds<CreateOrderRequest, WrongTotal, CreateOrderRelation>
>;

type WrongCurrency = SetPath<
  CreateOrderResponse,
  "/order/line_item_group/total/currency",
  "usd"
>;
// Why: the response total currency is derived from the request line items.
type _RejectWrongCurrency = Assert<
  // @ts-expect-error the request establishes ghs as the order currency
  RelationHolds<CreateOrderRequest, WrongCurrency, CreateOrderRelation>
>;

type WrongLifecycleBranch = SetPath<
  CreateOrderResponse,
  "/order/status",
  "preparing"
>;
// Why: finalize=true and execute_payment=false selects requires_payment, so a
// preparing response contradicts the operation's declared scenario.
type _RejectWrongLifecycleBranch = Assert<
  // @ts-expect-error the controlling request values require requires_payment
  RelationHolds<
    CreateOrderRequest,
    WrongLifecycleBranch,
    CreateOrderRelation
  >
>;

type PaymentMethodInvalid =
  OperationExamples["createOrder"]["responses"]["400"]["payment_method_invalid"];
type _ErrorTupleMatchesOperation = Assert<
  PaymentMethodInvalid extends ResponseBody<
    "createOrder",
    "400",
    "application/json"
  >
    ? true
    : false
>;

type WrongOperationError = SetPath<
  PaymentMethodInvalid,
  "/code",
  "not_a_create_order_error"
>;
// Why: an error-shaped object is not sound unless its exact tuple belongs to
// this operation and status.
type _RejectWrongOperationError = Assert<
  // @ts-expect-error the substituted code is outside createOrder's 400 response
  WrongOperationError extends ResponseBody<
    "createOrder",
    "400",
    "application/json"
  >
    ? true
    : false
>;
