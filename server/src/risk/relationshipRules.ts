import type { EntityType, RelationshipPredicate } from "@mri/shared";

/**
 * What code can and cannot establish about a model-proposed relationship.
 *
 * Code CAN prove: both entities exist and are grounded in the message; the cited quote occurs
 * verbatim in the cited snippet; the entity types are the kind the predicate connects at all.
 * Code CANNOT prove that the quote *means* the predicate. There is deliberately no second model
 * to ask. So the semantics of a kept relationship are the model's reading, and the product says so.
 *
 * Only STRUCTURE is enforced here: a structurally impossible relationship (for example "an amount
 * threatens an organization") is rejected. Whether the quote supports the type is advisory and is
 * computed at read time (relationshipSupport.ts); no English word list removes a relationship.
 */

type T = EntityType;
const PARTY: T[] = ["person", "organization"];

/** Allowed (from, to) entity types per predicate. `amount` as a target of a transfer is "the thing transferred". */
const TYPES: Record<RelationshipPredicate, { from: T[]; to: T[] }> = {
  employed_by: { from: ["person"], to: ["organization"] },
  sent_email_to: { from: PARTY, to: PARTY },
  requests_transfer_to: { from: PARTY, to: ["account", "organization", "person", "amount"] },
  impersonates: { from: PARTY, to: PARTY },
  owns_account: { from: PARTY, to: ["account"] },
  invoices: { from: PARTY, to: ["organization", "person", "amount"] },
  shares_information_with: { from: PARTY, to: PARTY },
  threatens: { from: PARTY, to: PARTY },
  alleges_against: { from: PARTY, to: PARTY },
  instructs: { from: PARTY, to: PARTY },
  related_to: { from: ["person", "organization", "account", "amount", "location"], to: ["person", "organization", "account", "amount", "location"] },
};

export type RelationshipCheck = { ok: true } | { ok: false; reason: "endpoint_types" | "self_reference" };

export function checkRelationship(
  predicate: RelationshipPredicate,
  fromType: EntityType,
  toType: EntityType,
  quote: string,
  sameEntity: boolean,
): RelationshipCheck {
  if (sameEntity) return { ok: false, reason: "self_reference" };
  const t = TYPES[predicate];
  if (!t.from.includes(fromType) || !t.to.includes(toType)) return { ok: false, reason: "endpoint_types" };
  return { ok: true };
}
