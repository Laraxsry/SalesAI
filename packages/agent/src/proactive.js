/**
 * Instructions the agent-worker injects on its own initiative, rather than in
 * reply to something the visitor said.
 *
 * These are one-shot `generateReply({ instructions })` payloads, never part of
 * the system prompt: a standing rule would have the model reasoning about when
 * to be proactive on every single turn, which is exactly the judgement we are
 * taking away from it. The worker decides *when*; these decide *what shape*.
 */

/**
 * What to say when the visitor has gone quiet and there is no presentation
 * plan running.
 *
 * Deliberately content-free — it hands the model the turn without telling it
 * what to fill the turn with. Choosing that is what the persona and the
 * knowledge base are for, and a canned line ("Are you still there?") repeated
 * three times is worse than silence.
 *
 * The escalation is real but gentle: a first nudge re-engages, a later one
 * should be shorter and offer an exit, because by then the likeliest
 * explanation is that nobody is listening.
 *
 * @param {{ consecutive?: number }} [ctx] how many unanswered nudges have
 *   already gone out, this one included
 * @returns {string}
 */
export function buildIdleNudgeInstructions({ consecutive = 1 } = {}) {
    if (consecutive >= 3) {
        return [
            'The visitor has been quiet for a while and has not responded to your last two attempts.',
            'Say one short, warm closing line that leaves the door open — offer to continue whenever they are ready.',
            'Do not ask another question. Do not call any tools.'
        ].join(' ');
    }

    if (consecutive === 2) {
        return [
            'The visitor is still quiet.',
            'In one short sentence, offer a concrete next thing you could show or explain, and ask if they would like that.',
            'Do not repeat what you already said. Do not remark on the silence itself.'
        ].join(' ');
    }

    return [
        'The visitor has gone quiet.',
        'Take the turn: in one or two short sentences, move the conversation forward — pick up the most useful thread so far, or offer something concrete you can show or explain next.',
        'Do not remark on the silence, do not ask if they are still there, and do not repeat your previous message.'
    ].join(' ');
}

/**
 * Turns one playbook step into the instruction the model actually receives.
 *
 * The `directive` is a marketer's private note ("Şirketi tanıt: kuruluş yılı,
 * kaç ülkede faaliyet, müşteri sayısı"). Handed over raw, a voice model will
 * happily read it out — colon, comma-list and all — which is fatal out loud.
 * So the note is always framed as a topic to cover, never as a line to deliver.
 *
 * The model sees ONLY this string. It never learns that a plan exists, how many
 * steps it has, or which one this is. That is the invariant the whole design
 * rests on: a model that cannot see the plan cannot narrate the plan, announce
 * an agenda, or lose its place in one.
 *
 * @param {{ directive: string, attach?: string|null, url?: string|null }} node
 * @param {object} [opts]
 * @param {boolean} [opts.screenVisible] a page is already on the visitor's screen
 * @param {boolean} [opts.resuming] this step was cut short earlier and is being retried
 * @returns {string}
 */
export function wrapDirective(node, { screenVisible = false, resuming = false } = {}) {
    const lines = [
        'Cover the following topic now, in your own words, as a natural part of the conversation.',
        'This is a private note to you: never read it aloud, never quote it, and never mention that you were told to say anything.',
        `Topic: ${node.directive}`
    ];

    if (screenVisible) {
        lines.push(
            'The relevant page is already open on the visitor\'s screen — talk about what is there as if you had just brought it up. Do not announce that you are navigating, and do not describe the act of opening a page.'
        );
    }

    // Gated on screenVisible: clicking something on a screen that isn't
    // actually showing (navigation failed or hasn't finished) sends the
    // model hunting for an element that was never rendered — a guaranteed,
    // pointless click_element timeout instead of just narrating the content.
    if (node.attach && screenVisible) {
        lines.push(
            `As part of this, point out and click the "${node.attach}" element using click_element, and say what it does as you do it.`
        );
    }

    if (resuming) {
        lines.push(
            'You started this topic a moment ago and were interrupted. Continue from where you left off — do not start over and do not repeat yourself.'
        );
    }

    return lines.join('\n');
}
