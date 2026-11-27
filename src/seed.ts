import type { Db } from "./db.ts";
import type { OpRegistry } from "./ops/registry.ts";

/**
 * Starting configuration from the spec (section 3 of the original handoff). Everything here is
 * editable data, not code: change it in the app later. Capacity minutes are placeholders.
 */
export const SEED_WORKSTREAMS = [
  { name: "Business development", colour: "#4f8cff", daily_target_min: 60, is_core: true, sort_order: 10 },
  { name: "Production and creative practice", colour: "#a26bff", daily_target_min: 150, is_core: true, sort_order: 20 },
  { name: "Client delivery", colour: "#2fbf71", daily_target_min: 0, is_core: true, sort_order: 30 },
  { name: "AI infrastructure and research", colour: "#f2a33a", daily_target_min: 120, is_core: false, sort_order: 40 },
  { name: "Personal administration", colour: "#7c8aa5", daily_target_min: 0, is_core: false, sort_order: 50 },
];

/** Minutes available per weekday, Monday first. Placeholder values: Monday to Saturday planning, Sunday optional. */
export const SEED_CAPACITY = [420, 420, 420, 420, 420, 420, 0];

const MASTER_CONTEXT = `# Master context

## Direction
AI-Powered Visual Communication Engineering: professional visual communication for companies using
AI-assisted video production, motion graphics, animation, data visualisation and interactive formats.

## Workstreams and normal allocations
- Business development and distribution (about 1 hour a day): organic LinkedIn publishing, relevant
  Facebook business communities, credibility, demonstrations, client acquisition.
- Production capability and creative practice (about 2 to 3 hours a day): HyperFrames development,
  reusable video templates, onboarding explainers, SOP and process videos, safety explainers,
  screen-recording and software training videos, motion design practice, demo portfolio.
- AI infrastructure and research (about 2 hours a day, subject to reprioritisation): OpenBot,
  agents and automation, content research systems, AI-assisted workflows, infrastructure experiments.
- Client delivery (as needed): assignments, production, revisions, communication, deadlines.
  Client work can override exploratory work.

These are normal allocations, not appointments. Client work, urgent deadlines and milestones can
justify reallocating time. Exploratory research must not keep taking time from business
development and production.

## Known weaknesses this system exists to counter
Staying on task, consistent execution, distraction and project switching, too many competing ideas,
remembering commitments, progress across multiple projects, turning long-term objectives into daily work.
`;

const OBJECTIVES = `# Objectives

_Write your long-term objectives here in your own words. Structured objectives live in the app;
this file holds the reasoning behind them._
`;

const OPERATING_RULES = `# Operating rules

1. Protect capacity: never schedule more work than the available hours.
2. Limit daily priorities: at most three important outcomes a day.
3. Three weekly outcomes: always visible; other work can exist around them.
4. No automatic endless rollover: unfinished work is triaged (tomorrow, later this week, backlog or drop).
5. Challenge inactivity: point out projects that get talked about but not executed.
6. Distinguish activity from output: research hours are not a finished template.
7. Protect core work: business development, production and paying clients must not keep losing time to exploration.
8. Keep an idea backlog: new opportunities do not become active projects automatically.
9. Explain prioritisation: every suggested change comes with a one-sentence reason.
10. Do not punish legitimate changes: urgent client work and genuine interruptions are treated fairly.
`;

const AI_INSTRUCTIONS = `# AI instructions

1. Role: chief of staff for one person. Direct, brief, never flattering. Explain each recommendation in one sentence.
2. Source of truth: the context pack and tools are the facts. If a fact is missing, ask or search; never rely on memory of earlier chats.
3. Classification: every statement is an idea, possible project, commitment, task, milestone, project, decision, blocker,
   completed activity or change in circumstances. Ideas and possible projects go only to the idea backlog.
4. Operations: change data only through the provided operations. Check for an existing task before creating one.
5. Run the operating rules as checks before proposing any plan.
6. Accountability tone: name the pattern, give the number, propose one change. No lectures.
`;

export const SEED_DOCUMENTS: { path: string; body: string }[] = [
  { path: "AI_INSTRUCTIONS.md", body: AI_INSTRUCTIONS },
  { path: "brain/MASTER_CONTEXT.md", body: MASTER_CONTEXT },
  { path: "brain/OBJECTIVES.md", body: OBJECTIVES },
  { path: "brain/OPERATING_RULES.md", body: OPERATING_RULES },
];

export interface SeedResult {
  seeded: boolean;
  workstreams: number;
  documents: number;
}

/** Load the starting configuration through the ops layer (so it is validated and recorded). Skips if already seeded. */
export async function seed(db: Db, registry: OpRegistry): Promise<SeedResult> {
  const existing = await db.first<{ n: number }>("SELECT count(*) AS n FROM workstreams");
  if ((existing?.n ?? 0) > 0) return { seeded: false, workstreams: 0, documents: 0 };
  const opts = { actor: "system" as const };
  for (const ws of SEED_WORKSTREAMS) await registry.run(db, "workstream.create", ws, opts);
  for (const [weekday, available_min] of SEED_CAPACITY.entries()) {
    await registry.run(db, "capacity.set", { weekday, available_min }, opts);
  }
  for (const doc of SEED_DOCUMENTS) await registry.run(db, "document.put", doc, opts);
  return { seeded: true, workstreams: SEED_WORKSTREAMS.length, documents: SEED_DOCUMENTS.length };
}
