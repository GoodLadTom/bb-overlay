// Jev piles for the Inbox page, shared by the server (questions, rule) and the
// app (labels, colours). Pure data: no Node or DOM imports.

export const PILE_IDS = ["reply_today", "clients", "partners", "billing", "community", "social", "newsletters", "fyi", "spam"] as const;
export type PileId = (typeof PILE_IDS)[number];

/** Labels and dot colours, in the order the member reads them. Warm palette, gold first, no blue. */
export const PILES: Record<PileId, { label: string; color: string }> = {
  reply_today: { label: "Reply today", color: "#D4A354" },
  clients: { label: "Clients & leads", color: "#C8754A" },
  partners: { label: "Partners & sponsors", color: "#7FA37A" },
  billing: { label: "Billing & receipts", color: "#B8A05A" },
  community: { label: "Community", color: "#E2C275" },
  social: { label: "Social & notifications", color: "#8C9A82" },
  newsletters: { label: "Newsletters", color: "#A88B6A" },
  fyi: { label: "FYI", color: "#8A8781" },
  spam: { label: "Spam", color: "#B5503F" },
};

/** "Reply today" is a rule in code, not only a Jev option: a person asks the member for something, soon. */
export const REPLY_RULE = { needsReply: 0.6, fromPerson: 0.5, urgency: 1.5 } as const;

export const URGENCY_LEVELS = ["No reply expected", "Some time this week", "Within a day or two", "Today, or blocked"];
