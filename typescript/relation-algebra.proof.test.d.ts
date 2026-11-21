import type { ResponseRelation } from "./contract-ir";
import type { Assert, RelationHolds, SetPath } from "./proof-kernel";

type PagePaymentMethodsRelation = ResponseRelation<
  "pagePaymentMethods",
  "200",
  "application/json"
>;

type DefaultedPageRequest = {};
type DefaultedPageResponse = { readonly page: { readonly number: 1 } };

// Why: an omitted optional request value still establishes its documented
// default as a response obligation.
type _DefaultedPageNumberIsSound = Assert<
  RelationHolds<
    DefaultedPageRequest,
    DefaultedPageResponse,
    PagePaymentMethodsRelation
  >
>;

type WrongDefaultedPage = SetPath<DefaultedPageResponse, "/page/number", 2>;
type _RejectWrongDefaultedPage = Assert<
  // @ts-expect-error the absent request value defaults the response page to 1
  RelationHolds<
    DefaultedPageRequest,
    WrongDefaultedPage,
    PagePaymentMethodsRelation
  >
>;

type UpdateOperatingPolicyRelation = ResponseRelation<
  "updateOperatingPolicy",
  "200",
  "application/json"
>;
type VersionedPolicyRequest = {
  readonly operating_policy_id: "op_example";
  readonly expected_version: 3;
};
type VersionedPolicyResponse = {
  readonly operating_policy: {
    readonly id: "op_example";
    readonly version: 4;
    // Why: updating a policy atomically activates the same new immutable version,
    // so the proof fixture must establish both response obligations.
    readonly active_version: 4;
  };
};

// Why: request expressions participate in arithmetic proofs just like literal
// and path expressions; the response version is expected_version + 1.
type _IncrementedPolicyVersionIsSound = Assert<
  RelationHolds<
    VersionedPolicyRequest,
    VersionedPolicyResponse,
    UpdateOperatingPolicyRelation
  >
>;

type StalePolicyVersion = SetPath<
  VersionedPolicyResponse,
  "/operating_policy/version",
  3
>;
type _RejectStalePolicyVersion = Assert<
  // @ts-expect-error the response version must advance from 3 to 4
  RelationHolds<
    VersionedPolicyRequest,
    StalePolicyVersion,
    UpdateOperatingPolicyRelation
  >
>;

type StaleActivePolicyVersion = SetPath<
  VersionedPolicyResponse,
  "/operating_policy/active_version",
  3
>;
type _RejectStaleActivePolicyVersion = Assert<
  // @ts-expect-error the newly created version must also be the active version
  RelationHolds<
    VersionedPolicyRequest,
    StaleActivePolicyVersion,
    UpdateOperatingPolicyRelation
  >
>;

type CancelPurchaseIntentRelation = ResponseRelation<
  "cancelPurchaseIntent",
  "200",
  "application/json"
>;
type AliasSelectedPurchaseIntent = {
  readonly id: "sale_alias_selected";
};
type AliasSelectedCancellation = {
  readonly purchase_intent: { readonly id: "sale_alias_selected" };
};

// Why: public request aliases must prove one response identity without requiring
// callers to submit both names or letting synthesis choose an unrelated target.
type _CoalescedPurchaseIntentAliasIsSound = Assert<
  RelationHolds<
    AliasSelectedPurchaseIntent,
    AliasSelectedCancellation,
    CancelPurchaseIntentRelation
  >
>;

type WrongCoalescedPurchaseIntentAlias = SetPath<
  AliasSelectedCancellation,
  "/purchase_intent/id",
  "sale_unrelated"
>;
type _RejectWrongCoalescedPurchaseIntentAlias = Assert<
  // @ts-expect-error the first present request alias fixes the response identity
  RelationHolds<
    AliasSelectedPurchaseIntent,
    WrongCoalescedPurchaseIntentAlias,
    CancelPurchaseIntentRelation
  >
>;
