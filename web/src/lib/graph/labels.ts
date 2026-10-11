import type { EntityType } from "@mri/shared";
import type { GraphNodeModel } from "./model";

/** Plain-language wording for the graph. Provenance and risk wording stay in `lib/copy.ts`. */

export const TYPE_LABEL: Record<EntityType, string> = {
  person: "Person or address",
  organization: "Organization",
  account: "Account",
  amount: "Amount",
  location: "Location",
};

export const TYPE_SHORT: Record<EntityType, string> = {
  person: "Person",
  organization: "Organization",
  account: "Account",
  amount: "Amount",
  location: "Location",
};

export const ORIGIN_LABEL: Record<GraphNodeModel["origin"], string> = {
  ai: "AI",
  rules: "Automatic",
};

export const ORIGIN_LONG: Record<GraphNodeModel["origin"], string> = {
  ai: "Identified by a validated AI assessment",
  rules: "Derived automatically (for example a message header), not by the AI",
};

/** What the API's `key_basis` means for how far this node can be trusted to be "one thing". */
export function keyBasisText(basis: string): string {
  switch (basis) {
    case "email_address":
      return "Identified by a verified e-mail address, so it can be the same person across messages.";
    case "organization_name":
      return "Identified by its normalized name. Matching names are merged; similar names are not.";
    case "account_with_owner":
      return "Identified by account number and owning organization.";
    case "location_name":
      return "Identified by its name.";
    case "email_scoped":
      return "Kept separate for one message: it is not merged with similar names in other messages.";
    default:
      return "Identity basis not described.";
  }
}

/** Plain-language risk caveat: the level belongs to the messages, not to the entity. */
export const RISK_CAVEAT =
  "The highest risk among the messages that mention it. It is a signal from those messages, not a finding about this entity.";
