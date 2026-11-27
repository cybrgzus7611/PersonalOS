import { OpRegistry } from "./registry.ts";
import { workstreamOps } from "./workstreams.ts";
import { milestoneOps, objectiveOps, projectOps } from "./strategy.ts";
import { taskOps } from "./tasks.ts";
import { decisionOps, documentOps, ideaOps, noteOps } from "./memory.ts";
import { configOps } from "./config.ts";
import { undoOps } from "./undo.ts";

/** The single list of operations allowed to change data (spec section 2). */
export function createRegistry(): OpRegistry {
  return new OpRegistry().register(
    ...workstreamOps,
    ...objectiveOps,
    ...projectOps,
    ...milestoneOps,
    ...taskOps,
    ...ideaOps,
    ...decisionOps,
    ...noteOps,
    ...documentOps,
    ...configOps,
    ...undoOps,
  );
}

export const registry = createRegistry();
export type { Actor, OpOutcome, Tier } from "./registry.ts";
