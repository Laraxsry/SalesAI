import { Schema, model } from 'mongoose';

/**
 * The ordered presentation route a playbook-enabled agent walks a visitor
 * through for the full design. One document
 * per agent, one flat ordered list of steps; no branching, no canvas
 * coordinates. The worker never re-reads this document mid-session: it snaps
 * `nodes` into a plain array at session start (that snapshot IS the version
 * pin) and runs off that copy for the life of the call, so a marketer editing
 * a live playbook can never change what an in-progress conversation does.
 */
const PlaybookNodeSchema = new Schema(
    {
        id: { type: String, required: true },
        order: { type: Number, required: true },
        /** Page to show for this step; null means stay on whatever is already
         *  on screen (or show nothing, for a pure-narration step). */
        url: { type: String, default: null },
        /** The marketer's private note on what to cover — never spoken
         *  verbatim, always wrapped before it reaches the model (see
         *  @repo/agent's wrapDirective). */
        directive: { type: String, required: true },
        /** Natural-language description of an on-screen element to click,
         *  resolved by the model at runtime — not a stored CSS selector. */
        attach: { type: String, default: null },
        mode: {
            type: String,
            enum: ['important', 'situational', 'skip-if-no-answer'],
            default: 'situational'
        }
    },
    { _id: false } // subdocuments are addressed by their own `id`, not Mongo's;
    // without this Mongoose mints an `_id` per node that the editor never sent
    // and the API would round-trip a field nobody asked for.
);

const PlaybookSchema = new Schema(
    {
        agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, unique: true, index: true },
        // Bumped on every save (see the API route) so a transcript can record
        // exactly which revision a given session ran against, even though the
        // session itself never reads this document again after start.
        version: { type: Number, default: 1 },
        enabled: { type: Boolean, default: true },
        nodes: { type: [PlaybookNodeSchema], default: [] }
    },
    { timestamps: true }
);

export const Playbook = model('Playbook', PlaybookSchema);
