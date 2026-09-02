import { Schema, model } from 'mongoose';

/**
 * FollowUpTask — a specific question the agent could not answer from
 * `search_knowledge`, that the visitor explicitly asked to have forwarded to
 * the team. Created live, during the call, by the `flag_followup_needed`
 * tool (packages/agent/src/tools.js) — NOT a post-call analysis artifact.
 *
 * Deliberately separate from two other, easily-confused things:
 * - `Lead` — a per-session engagement SCORE (one per session, unique), not
 *   tied to any specific question.
 * - `KnowledgeGapReport` — a manually-triggered, content-only analysis of
 *   the knowledge base itself, unrelated to any real conversation.
 *
 * Not unique per session on purpose — a visitor can ask several things the
 * agent can't answer in one call, each becomes its own task.
 *
 * `department` is a placeholder for the routing infrastructure planned for
 * later (deciding which team a task goes to); it is unused today and stays
 * null until that work exists — added now so the schema doesn't need a
 * migration when it lands.
 */
const FollowUpTaskSchema = new Schema(
    {
        sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
        agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
        question: { type: String, required: true },
        status: {
            type: String,
            enum: ['pending', 'routed', 'resolved'],
            default: 'pending',
            index: true
        },
        department: { type: String, default: null }
    },
    { timestamps: true }
);

export const FollowUpTask = model('FollowUpTask', FollowUpTaskSchema);
