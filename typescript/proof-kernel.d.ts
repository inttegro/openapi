/**
 * Types-only proof kernel for the generated Inttegro contract.
 *
 * Nothing in this module exists at runtime. Contract declarations are
 * propositions, payload literals are witnesses, and Assert rejects a witness
 * whenever a declared relationship evaluates to false.
 */

export type JsonScalar = string | number | boolean | null;
export type JsonValue =
  | JsonScalar
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

export type Assert<Proof extends true> = Proof;

export type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

type And<Left extends boolean, Right extends boolean> = Left extends true
  ? Right
  : false;

type Every<Values extends readonly unknown[]> = Values extends readonly [
  infer Head,
  ...infer Tail,
]
  ? Head extends true
    ? Every<Tail>
    : false
  : true;

type TupleValues<Values extends readonly unknown[]> = Values[number];

type RequiredNames<Schema> = Schema extends {
  readonly required: readonly (infer Name extends PropertyKey)[];
}
  ? Name
  : never;

type InferProperties<
  Properties,
  Registry,
  Required extends PropertyKey,
> = Properties extends object
  ? {
      readonly [Name in keyof Properties as Name extends Required
        ? Name
        : never]-?: InferSchema<Properties[Name], Registry>;
    } & {
      readonly [Name in keyof Properties as Name extends Required
        ? never
        : Name]?: InferSchema<Properties[Name], Registry>;
    }
  : Record<string, unknown>;

type InferLocal<Schema, Registry> = Schema extends {
  readonly $ref: `#/components/schemas/${infer Name}`;
}
  ? Name extends keyof Registry
    ? InferSchema<Registry[Name], Registry>
    : never
  : Schema extends { readonly enum: readonly (infer Value)[] }
    ? Value
    : Schema extends { readonly type: "object" }
      ? InferProperties<
          Schema extends { readonly properties: infer Properties }
            ? Properties
            : {},
          Registry,
          RequiredNames<Schema>
        >
      : Schema extends { readonly properties: infer Properties }
        ? InferProperties<Properties, Registry, RequiredNames<Schema>>
        : Schema extends { readonly type: "array"; readonly items: infer Items }
          ? readonly InferSchema<Items, Registry>[]
          : Schema extends { readonly items: infer Items }
            ? readonly InferSchema<Items, Registry>[]
            : Schema extends { readonly type: "string" }
              ? string
              : Schema extends { readonly type: "integer" | "number" }
                ? number
                : Schema extends { readonly type: "boolean" }
                  ? boolean
                  : Schema extends { readonly type: "null" }
                    ? null
                    : unknown;

type InferAllOfParts<
  Parts extends readonly unknown[],
  Registry,
> = Parts extends readonly [infer Head, ...infer Tail]
  ? InferSchema<Head, Registry> & InferAllOfParts<Tail, Registry>
  : unknown;

type InferAllOf<Schema, Registry> = Schema extends {
  readonly allOf: infer Parts extends readonly unknown[];
}
  ? InferAllOfParts<Parts, Registry>
  : unknown;

type InferChoice<Schema, Registry> = Schema extends {
  readonly oneOf: infer Choices extends readonly unknown[];
}
  ? InferSchema<TupleValues<Choices>, Registry>
  : Schema extends {
        readonly anyOf: infer Choices extends readonly unknown[];
      }
    ? InferSchema<TupleValues<Choices>, Registry>
    : unknown;

type WithNullable<Schema, Value> = Schema extends { readonly nullable: true }
  ? Value | null
  : Value;

/** Infer the payload represented by a generated OpenAPI schema algebra node. */
export type InferSchema<Schema, Registry> = Schema extends unknown
  ? WithNullable<
      Schema,
      InferLocal<Schema, Registry> &
        InferAllOf<Schema, Registry> &
        InferChoice<Schema, Registry>
    >
  : never;

declare const missingPath: unique symbol;
export type Missing = { readonly [missingPath]: true };

type DecodePointer<Segment extends string> = Segment extends `${infer Head}~1${infer Tail}`
  ? DecodePointer<`${Head}/${Tail}`>
  : Segment extends `${infer Head}~0${infer Tail}`
    ? DecodePointer<`${Head}~${Tail}`>
    : Segment;

type StepPresent<Value, Segment extends string> = Value extends unknown
  ? Segment extends "*"
    ? Value extends readonly (infer Item)[]
      ? Item
      : Missing
    : DecodePointer<Segment> extends keyof Value
      ? Value[DecodePointer<Segment>]
      : Missing
  : never;

type StepPath<Value, Segment extends string> = [NonNullable<Value>] extends [never]
  ? Missing
  : StepPresent<NonNullable<Value>, Segment>;

/** Select a value using an RFC 6901 pointer; an entire `*` segment selects array items. */
export type PathValue<
  Value,
  Pointer extends string,
> = Pointer extends "" | "/"
  ? Value
  : Pointer extends `/${infer Segment}/${infer Rest}`
    ? PathValue<StepPath<Value, Segment>, `/${Rest}`>
    : Pointer extends `/${infer Segment}`
      ? StepPath<Value, Segment>
      : Missing;

type IsMissing<Value> = [Exclude<Value, Missing>] extends [never]
  ? true
  : false;

type PathExists<Value, Pointer extends string> = IsMissing<
  PathValue<Value, Pointer>
> extends true
  ? false
  : true;

type Existing<Value> = Exclude<Value, Missing>;

type PathsExist<
  Value,
  Paths extends readonly unknown[],
> = Paths extends readonly [infer Head, ...infer Tail]
  ? Head extends string
    ? PathExists<Value, Head> extends true
      ? PathsExist<Value, Tail>
      : false
    : false
  : true;

type PredicatePath<Predicate> = Predicate extends {
  readonly path: infer Pointer extends string;
}
  ? PathExists<unknown, Pointer> extends boolean
    ? Pointer
    : never
  : never;

type PredicateWellFormed<Value, Predicate> = Predicate extends {
  readonly compare: {
    readonly left: { readonly path: infer Left extends string };
    readonly right: { readonly path: infer Right extends string };
  };
}
  ? And<PathExists<Value, Left>, PathExists<Value, Right>>
  : Predicate extends { readonly path: infer Pointer extends string }
    ? PathExists<Value, Pointer>
    : false;

type ConsequencesWellFormed<
  Value,
  Consequences extends readonly unknown[],
> = Consequences extends readonly [infer Head, ...infer Tail]
  ? Head extends { readonly path: infer Pointer extends string }
    ? PathExists<Value, Pointer> extends true
      ? ConsequencesWellFormed<Value, Tail>
      : false
    : false
  : true;

type ExpressionWellFormed<Value, Expression> = Expression extends {
  readonly path: infer Pointer extends string;
}
  ? PathExists<Value, Pointer>
  : Expression extends { readonly literal: unknown }
    ? true
    : Expression extends {
          readonly add: infer Operands extends readonly unknown[];
        }
      ? ExpressionsWellFormed<Value, Operands>
      : Expression extends {
            readonly subtract: infer Operands extends readonly unknown[];
          }
        ? ExpressionsWellFormed<Value, Operands>
        : Expression extends {
              readonly multiply: infer Operands extends readonly unknown[];
            }
          ? ExpressionsWellFormed<Value, Operands>
          : false;

type ExpressionsWellFormed<
  Value,
  Expressions extends readonly unknown[],
> = Expressions extends readonly [infer Head, ...infer Tail]
  ? ExpressionWellFormed<Value, Head> extends true
    ? ExpressionsWellFormed<Value, Tail>
    : false
  : true;

type TransitionPaths<
  Transitions extends readonly unknown[],
> = Transitions extends readonly [infer Head, ...infer Tail]
  ? Head extends { readonly at: infer Pointer extends string }
    ? readonly [Pointer, ...TransitionPaths<Tail>]
    : TransitionPaths<Tail>
  : readonly [];

/** Prove that every path used by a Simile relationship resolves on its owner. */
export type ConstraintWellFormed<Value, Constraint> =
  Constraint extends {
    readonly ordered: { readonly paths: infer Paths extends readonly unknown[] };
  }
    ? PathsExist<Value, Paths>
    : Constraint extends {
          readonly bounded: infer Bound;
        }
      ? Bound extends { readonly path: infer Target extends string }
        ? And<
            PathExists<Value, Target>,
            PathsExist<
              Value,
              readonly [
                Bound extends { readonly minimum: { readonly path: infer P extends string } }
                  ? P
                  : "/",
                Bound extends { readonly maximum: { readonly path: infer P extends string } }
                  ? P
                  : "/",
                Bound extends {
                  readonly "exclusive-minimum": { readonly path: infer P extends string };
                }
                  ? P
                  : "/",
                Bound extends {
                  readonly "exclusive-maximum": { readonly path: infer P extends string };
                }
                  ? P
                  : "/",
              ]
            >
          >
        : false
      : Constraint extends {
            readonly implies: {
              readonly when: infer When;
              readonly then: {
                readonly all: infer Consequences extends readonly unknown[];
              };
            };
          }
        ? And<
            PredicateWellFormed<Value, When>,
            ConsequencesWellFormed<Value, Consequences>
          >
        : Constraint extends {
              readonly equal: { readonly paths: infer Paths extends readonly unknown[] };
            }
          ? PathsExist<Value, Paths>
          : Constraint extends {
                readonly distinct: { readonly source: infer Source extends string };
              }
            ? PathExists<Value, Source>
            : Constraint extends {
                  readonly set: {
                    readonly left: infer Left extends string;
                    readonly right: infer Right extends string;
                  };
                }
              ? And<PathExists<Value, Left>, PathExists<Value, Right>>
              : Constraint extends {
                    readonly equation: {
                      readonly target: infer Target extends string;
                      readonly value: infer Expression;
                    };
                  }
                ? And<
                    PathExists<Value, Target>,
                    ExpressionWellFormed<Value, Expression>
                  >
                : Constraint extends {
                      readonly aggregate: {
                        readonly target: infer Target extends string;
                        readonly source: infer Source extends string;
                      };
                    }
                  ? And<PathExists<Value, Target>, PathExists<Value, Source>>
                  : Constraint extends {
                        readonly template: {
                          readonly path: infer Target extends string;
                        };
                      }
                    ? PathExists<Value, Target>
                    : Constraint extends {
                          readonly lifecycle: {
                            readonly state: infer State extends string;
                            readonly "created-at": infer Created extends string;
                            readonly transitions: infer Transitions extends readonly unknown[];
                          };
                        }
                      ? PathsExist<
                          Value,
                          readonly [State, Created, ...TransitionPaths<Transitions>]
                        >
                      : false;

type ConstraintsWellFormedTuple<
  Value,
  Constraints extends readonly unknown[],
> = Constraints extends readonly [infer Head, ...infer Tail]
  ? ConstraintWellFormed<Value, Head> extends true
    ? ConstraintsWellFormedTuple<Value, Tail>
    : false
  : true;

export type ConstraintsWellFormed<
  Value,
  Constraints extends readonly unknown[],
> = ConstraintsWellFormedTuple<Value, Constraints>;

type ContainsObject<Target, Source extends object> = {
  [Name in keyof Source]-?: Name extends keyof Target
    ? Contains<Target[Name], Source[Name]>
    : false;
}[keyof Source] extends true
  ? true
  : false;

type ContainsTuple<
  Target extends readonly unknown[],
  Source extends readonly unknown[],
> = Source extends readonly [infer SourceHead, ...infer SourceTail]
  ? Target extends readonly [infer TargetHead, ...infer TargetTail]
    ? Contains<TargetHead, SourceHead> extends true
      ? ContainsTuple<TargetTail, SourceTail>
      : false
    : false
  : true;

/** Response values may enrich copied request objects, but may not change their fields. */
export type Contains<Target, Source> = [Source] extends [Missing]
  ? true
  : Source extends JsonScalar
    ? Equal<Target, Source>
    : Source extends readonly unknown[]
      ? Target extends readonly unknown[]
        ? number extends Source["length"]
          ? Contains<Target[number], Source[number]>
          : ContainsTuple<Target, Source>
        : false
      : Source extends object
        ? Target extends object
          ? ContainsObject<Target, Source>
          : false
        : Equal<Target, Source>;

type BuildTuple<
  Length extends number,
  Values extends readonly unknown[] = readonly [],
> = Values["length"] extends Length
  ? Values
  : BuildTuple<Length, readonly [...Values, unknown]>;

type AddNumbers<Left extends number, Right extends number> = Left extends 0
  ? Right
  : Right extends 0
    ? Left
    : [...BuildTuple<Left>, ...BuildTuple<Right>]["length"];

type SubtractNumbers<Left extends number, Right extends number> =
  BuildTuple<Left> extends readonly [...BuildTuple<Right>, ...infer Rest]
    ? Rest["length"]
    : never;

type MultiplyLoop<
  Count extends number,
  Value extends number,
  Seen extends readonly unknown[] = readonly [],
  Result extends number = 0,
> = Seen["length"] extends Count
  ? Result
  : AddNumbers<Result, Value> extends infer Next extends number
    ? MultiplyLoop<Count, Value, readonly [...Seen, unknown], Next>
    : never;

type MultiplyNumbers<Left extends number, Right extends number> = Left extends 0
  ? 0
  : Right extends 0
    ? 0
    : Left extends 1
      ? Right
      : Right extends 1
        ? Left
        : MultiplyLoop<Left, Right>;

type MapPath<Items extends readonly unknown[], Pointer extends string> =
  Items extends readonly []
    ? readonly []
    : Items extends readonly [infer Head, ...infer Tail]
    ? readonly [PathValue<Head, Pointer>, ...MapPath<Tail, Pointer>]
    : Items extends readonly (infer Item)[]
      ? readonly PathValue<Item, Pointer>[]
      : readonly [];

export type CollectPath<Value, Pointer extends string> = Pointer extends "" | "/"
  ? readonly [Value]
  : Pointer extends `/${infer Segment}/${infer Rest}`
    ? Segment extends "*"
      ? NonNullable<Value> extends readonly unknown[]
        ? MapPath<NonNullable<Value>, `/${Rest}`>
        : readonly []
      : CollectPath<StepPath<Value, Segment>, `/${Rest}`>
    : Pointer extends `/${infer Segment}`
      ? Segment extends "*"
        ? NonNullable<Value> extends readonly unknown[]
          ? NonNullable<Value>
          : readonly []
        : readonly [StepPath<Value, Segment>]
      : readonly [];

type AddExpressionValues<
  Expressions extends readonly unknown[],
  Root,
  Context,
  Result extends number = 0,
> = Expressions extends readonly [infer Head, ...infer Tail]
  ? EvaluateExpression<Head, Root, Context> extends infer Value extends number
    ? AddNumbers<Result, Value> extends infer Next extends number
      ? AddExpressionValues<Tail, Root, Context, Next>
      : never
    : never
  : Result;

type MultiplyExpressionValues<
  Expressions extends readonly unknown[],
  Root,
  Context,
  Result extends number = 1,
> = Expressions extends readonly [infer Head, ...infer Tail]
  ? EvaluateExpression<Head, Root, Context> extends infer Value extends number
    ? MultiplyNumbers<Result, Value> extends infer Next extends number
      ? MultiplyExpressionValues<Tail, Root, Context, Next>
      : never
    : never
  : Result;

type SumEach<
  Items extends readonly unknown[],
  Expression,
  Root,
  Result extends number = 0,
> = Items extends readonly [infer Head, ...infer Tail]
  ? Head extends Missing
    ? SumEach<Tail, Expression, Root, Result>
    : EvaluateExpression<Expression, Root, Head> extends infer Value extends number
      ? AddNumbers<Result, Value> extends infer Next extends number
        ? SumEach<Tail, Expression, Root, Next>
        : never
      : never
  : Result;

/** Evaluate the closed arithmetic and collection algebra used by response relations. */
export type EvaluateExpression<Expression, Root, Context = Root> =
  Expression extends { readonly request: infer Pointer extends string }
    ? Existing<PathValue<Root, Pointer>>
    : Expression extends { readonly literal: infer Value }
    ? Value
    : Expression extends { readonly path: infer Pointer extends string }
      ? Existing<PathValue<Context, Pointer>>
      : Expression extends {
            readonly add: infer Expressions extends readonly unknown[];
          }
        ? AddExpressionValues<Expressions, Root, Context>
        : Expression extends {
              readonly subtract: readonly [infer Left, infer Right];
            }
          ? EvaluateExpression<Left, Root, Context> extends infer LeftValue extends number
            ? EvaluateExpression<Right, Root, Context> extends infer RightValue extends number
              ? SubtractNumbers<LeftValue, RightValue>
              : never
            : never
          : Expression extends {
                readonly multiply: infer Expressions extends readonly unknown[];
              }
            ? MultiplyExpressionValues<Expressions, Root, Context>
            : Expression extends {
                  readonly sum: {
                    readonly each: infer Pointer extends string;
                    readonly value: infer ValueExpression;
                  };
                }
              ? CollectPath<Root, Pointer> extends infer Items extends readonly unknown[]
                ? SumEach<Items, ValueExpression, Root>
                : never
              : never;

type BindingWellFormed<Request, Response, Binding> = Binding extends {
  readonly to: infer Target extends string;
}
  ? PathExists<Response, Target> extends true
    ? Binding extends { readonly from: infer Source extends string }
      ? PathExists<Request, Source>
      : Binding extends { readonly value: infer Expression }
        ? RelationExpressionWellFormed<Request, Expression>
        : false
    : false
  : false;

type RelationExpressionWellFormed<Request, Expression> = Expression extends {
  readonly request: infer Pointer extends string;
}
  ? PathExists<Request, Pointer>
  : Expression extends { readonly path: infer Pointer extends string }
    ? PathExists<Request, Pointer>
    : Expression extends { readonly literal: unknown }
      ? true
      : Expression extends {
            readonly add: infer Operands extends readonly unknown[];
          }
        ? RelationExpressionsWellFormed<Request, Operands>
        : Expression extends {
              readonly subtract: infer Operands extends readonly unknown[];
            }
          ? RelationExpressionsWellFormed<Request, Operands>
          : Expression extends {
                readonly multiply: infer Operands extends readonly unknown[];
              }
            ? RelationExpressionsWellFormed<Request, Operands>
            : Expression extends {
                  readonly sum: {
                    readonly each: infer Pointer extends string;
                    readonly value: infer ValueExpression;
                  };
                }
              ? PathExists<Request, Pointer> extends true
                ? RelationExpressionWellFormed<
                    Existing<PathValue<Request, Pointer>>,
                    ValueExpression
                  >
                : false
              : false;

type RelationExpressionsWellFormed<
  Request,
  Expressions extends readonly unknown[],
> = Expressions extends readonly [infer Head, ...infer Tail]
  ? RelationExpressionWellFormed<Request, Head> extends true
    ? RelationExpressionsWellFormed<Request, Tail>
    : false
  : true;

type BindingsWellFormed<
  Request,
  Response,
  Bindings extends readonly unknown[],
> = Bindings extends readonly [infer Head, ...infer Tail]
  ? BindingWellFormed<Request, Response, Head> extends true
    ? BindingsWellFormed<Request, Response, Tail>
    : false
  : true;

type RelationPredicateWellFormed<Request, Predicate> = Predicate extends {
  readonly request: infer Pointer extends string;
}
  ? PathExists<Request, Pointer>
  : false;

type RelationWhenWellFormed<Request, When> = When extends {
  readonly all: infer Predicates extends readonly unknown[];
}
  ? RelationPredicatesWellFormed<Request, Predicates>
  : false;

type RelationPredicatesWellFormed<
  Request,
  Predicates extends readonly unknown[],
> = Predicates extends readonly [infer Head, ...infer Tail]
  ? RelationPredicateWellFormed<Request, Head> extends true
    ? RelationPredicatesWellFormed<Request, Tail>
    : false
  : true;

type ThenWellFormed<Response, Then> = And<
  Then extends { readonly set: infer Set extends object }
    ? PathsExist<Response, readonly (keyof Set & string)[]>
    : true,
  Then extends { readonly omit: infer Omit extends readonly unknown[] }
    ? PathsExist<Response, Omit>
    : true
>;

type RulesWellFormed<
  Request,
  Response,
  Rules extends readonly unknown[],
> = Rules extends readonly [infer Head, ...infer Tail]
  ? Head extends { readonly when: infer When; readonly then: infer Then }
    ? RelationWhenWellFormed<Request, When> extends true
      ? ThenWellFormed<Response, Then> extends true
        ? RulesWellFormed<Request, Response, Tail>
        : false
      : false
    : false
  : true;

/** Prove that relation sources and destinations resolve against operation payloads. */
export type RelationWellFormed<Request, Response, Relation> = And<
  Relation extends { readonly bindings: infer Bindings extends readonly unknown[] }
    ? BindingsWellFormed<Request, Response, Bindings>
    : true,
  Relation extends { readonly rules: infer Rules extends readonly unknown[] }
    ? RulesWellFormed<Request, Response, Rules>
    : true
>;

type BindingHolds<Request, Response, Binding> = Binding extends {
  readonly to: infer Target extends string;
}
  ? Binding extends { readonly from: infer Source extends string }
    ? PathValue<Request, Source> extends infer SourceValue
      ? IsMissing<SourceValue> extends true
        ? Binding extends { readonly default: infer Default }
          ? Contains<PathValue<Response, Target>, Default>
          : true
        : Contains<PathValue<Response, Target>, Existing<SourceValue>>
      : false
    : Binding extends { readonly value: infer Expression }
      ? Equal<
          PathValue<Response, Target>,
          EvaluateExpression<Expression, Request>
        >
      : false
  : false;

type BindingsHold<
  Request,
  Response,
  Bindings extends readonly unknown[],
> = Bindings extends readonly [infer Head, ...infer Tail]
  ? BindingHolds<Request, Response, Head> extends true
    ? BindingsHold<Request, Response, Tail>
    : false
  : true;

type RequestPredicateHolds<Request, Predicate> = Predicate extends {
  readonly request: infer Pointer extends string;
  readonly equals: infer Expected;
}
  ? PathValue<Request, Pointer> extends infer Actual
    ? IsMissing<Actual> extends true
      ? Predicate extends { readonly default: infer Default }
        ? Equal<Default, Expected>
        : false
      : Equal<Existing<Actual>, Expected>
    : false
  : false;

type RelationWhenHolds<Request, When> = When extends {
  readonly all: infer Predicates extends readonly unknown[];
}
  ? RelationPredicatesHold<Request, Predicates>
  : false;

type RelationPredicatesHold<
  Request,
  Predicates extends readonly unknown[],
> = Predicates extends readonly [infer Head, ...infer Tail]
  ? RequestPredicateHolds<Request, Head> extends true
    ? RelationPredicatesHold<Request, Tail>
    : false
  : true;

type SetHolds<Response, Set extends object> = {
  [Pointer in keyof Set]-?: Pointer extends string
    ? Equal<PathValue<Response, Pointer>, Set[Pointer]>
    : false;
}[keyof Set] extends true
  ? true
  : false;

type Omitted<Response, Paths extends readonly unknown[]> =
  Paths extends readonly [infer Head, ...infer Tail]
    ? Head extends string
      ? IsMissing<PathValue<Response, Head>> extends true
        ? Omitted<Response, Tail>
        : false
      : false
    : true;

type ThenHolds<Response, Then> = And<
  Then extends { readonly set: infer Set extends object }
    ? SetHolds<Response, Set>
    : true,
  Then extends { readonly omit: infer Paths extends readonly unknown[] }
    ? Omitted<Response, Paths>
    : true
>;

type RulesHold<
  Request,
  Response,
  Rules extends readonly unknown[],
> = Rules extends readonly [infer Head, ...infer Tail]
  ? Head extends { readonly when: infer When; readonly then: infer Then }
    ? RelationWhenHolds<Request, When> extends true
      ? ThenHolds<Response, Then> extends true
        ? RulesHold<Request, Response, Tail>
        : false
      : RulesHold<Request, Response, Tail>
    : false
  : true;

/** Establish that concrete request and response witnesses satisfy their relation. */
export type RelationHolds<Request, Response, Relation> = And<
  Relation extends { readonly bindings: infer Bindings extends readonly unknown[] }
    ? BindingsHold<Request, Response, Bindings>
    : true,
  Relation extends { readonly rules: infer Rules extends readonly unknown[] }
    ? RulesHold<Request, Response, Rules>
    : true
>;

/** Replace one concrete object path to construct deliberately unsound proof witnesses. */
export type SetPath<Value, Pointer extends string, Replacement> =
  Pointer extends `/${infer Segment}/${infer Rest}`
    ? DecodePointer<Segment> extends keyof Value
      ? {
          readonly [Name in keyof Value]: Name extends DecodePointer<Segment>
            ? SetPath<Value[Name], `/${Rest}`, Replacement>
            : Value[Name];
        }
      : Value
    : Pointer extends `/${infer Segment}`
      ? DecodePointer<Segment> extends keyof Value
        ? {
            readonly [Name in keyof Value]: Name extends DecodePointer<Segment>
              ? Replacement
              : Value[Name];
          }
        : Value
      : Replacement;
