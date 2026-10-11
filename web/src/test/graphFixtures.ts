import type { GraphEdge, GraphNode, GraphResponse } from "@mri/shared";

export function gNode(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    type: "organization",
    label: id,
    origin: "ai",
    key_basis: "organization_name",
    email_ids: ["E004"],
    mention_count: 1,
    max_risk: "medium",
    ...over,
  };
}

export function gEdge(source: string, target: string, over: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: `${source}|requests_transfer_to|${target}`,
    source,
    target,
    predicate: "requests_transfer_to",
    email_ids: ["E004"],
    count: 1,
    origin: "ai",
    evidence: [{ email_id: "E004", snippet_id: "s3", quote: "New payment account: routing 044000037, account ending 9902" }],
    ...over,
  };
}

export function gGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphResponse {
  return {
    nodes,
    edges,
    meta: {
      email_count: 10,
      node_count: nodes.length,
      edge_count: edges.length,
      basis: "Entities and relationships from validated AI assessments (complete analyses only) plus header-derived people.",
    },
  };
}

/** A realistic mix: one connected cluster, one pair, and isolated rule-derived addresses. */
export function sampleGraph(): GraphResponse {
  const nodes = [
    gNode("organization:name:northgate suppliers", { label: "Northgate Suppliers Inc.", email_ids: ["E004"] }),
    gNode("account:email:E004:account ending 9902", { type: "account", label: "account ending 9902", key_basis: "email_scoped" }),
    gNode("organization:name:arcline", { label: "Arcline", email_ids: ["E001", "E004"], max_risk: "high", mention_count: 2 }),
    gNode("person:email:E001:james", { type: "person", label: "James", email_ids: ["E001"], max_risk: "high", key_basis: "email_scoped" }),
    gNode("person:email:hr@arcline.com", { type: "person", label: "hr@arcline.com", origin: "rules", key_basis: "email_address", email_ids: ["E007"], max_risk: "none" }),
    gNode("person:email:billing@northgate-suppliers.com", { type: "person", label: "billing@northgate-suppliers.com", origin: "rules", key_basis: "email_address", email_ids: ["E004"] }),
  ];
  const edges = [
    gEdge("organization:name:northgate suppliers", "account:email:E004:account ending 9902"),
    gEdge("organization:name:northgate suppliers", "organization:name:arcline", {
      id: "organization:name:northgate suppliers|sent_email_to|organization:name:arcline",
      predicate: "sent_email_to",
      evidence: [{ email_id: "E004", snippet_id: "s1", quote: "Subject: Invoice #NS-4471 - please note updated payment details" }],
    }),
    gEdge("person:email:E001:james", "organization:name:arcline", {
      id: "person:email:E001:james|sent_email_to|organization:name:arcline",
      predicate: "sent_email_to",
      email_ids: ["E001"],
      evidence: [{ email_id: "E001", snippet_id: "s1", quote: "I need Finance to wire $184,500 to our new escrow partner" }],
    }),
  ];
  return gGraph(nodes, edges);
}
