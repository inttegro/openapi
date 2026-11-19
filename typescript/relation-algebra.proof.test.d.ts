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
