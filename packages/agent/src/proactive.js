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
 * Quotes back what the agent actually said last, so a "do not repeat yourself"
 * rule has something to point at.
 *
 * Every anti-repetition line in this file used to be a blind admonition: the
 * model was told not to repeat itself without ever being shown the sentence in
 * question. That is especially useless after an interruption, where the SDK
 * drops never-played messages from the chat context, so the model genuinely
 * cannot see what the visitor already heard.
 *
 * @param {string} [text]
 * @returns {string|null} a quoted reminder, or null when there is nothing to quote
 */
function alreadySaidLine(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;
    // Long enough to identify the utterance, short enough not to crowd out the
    // instruction itself.
    const excerpt = trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
    return `You already said this, and the visitor heard it: "${excerpt}" Do not say it again in any form.`;
}

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
 * @param {{ consecutive?: number, lastUtterance?: string }} [ctx]
 *   `consecutive` — how many unanswered nudges have already gone out, this one
 *   included. `lastUtterance` — what the agent actually said last, quoted back
 *   so the anti-repetition rule has a referent; omit it and the wording falls
 *   back to the blind form.
 * @returns {string}
 */
export function buildIdleNudgeInstructions({ consecutive = 1, lastUtterance } = {}) {
    const alreadySaid = alreadySaidLine(lastUtterance);

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
            alreadySaid || 'Do not repeat what you already said.',
            'Do not remark on the silence itself.'
        ]
            .filter(Boolean)
            .join(' ');
    }

    return [
        'The visitor has gone quiet.',
        'Take the turn: in one or two short sentences, move the conversation forward — pick up the most useful thread so far, or offer something concrete you can show or explain next.',
        'Do not remark on the silence and do not ask if they are still there.',
        alreadySaid || 'Do not repeat your previous message.'
    ]
        .filter(Boolean)
        .join(' ');
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
 * @param {string} [opts.spokenSoFar] what the agent actually got out before it
 *   was cut off — only meaningful together with `resuming`. Without it, "do not
 *   start over" is an instruction with nothing to anchor to.
 * @returns {string}
 */
export function wrapDirective(node, { screenVisible = false, resuming = false, spokenSoFar = null } = {}) {
    const lines = [
        'Cover the following topic now, in your own words, as a natural part of the conversation.',
        'This is a private note to you: never read it aloud, never quote it, and never mention that you were told to say anything.',
        `Topic: ${node.directive}`,
        'Say it as one natural thought inside the conversation you are already having — connect it to what was just said, and do not announce a new subject.',
        'If the note lists several things, lead with the one that matters most to this visitor right now. You do not have to get through all of it in one breath.'
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
        const alreadySaid = alreadySaidLine(spokenSoFar);
        if (alreadySaid) lines.push(alreadySaid);
    }

    return lines.join('\n');
}

/**
 * The half-sentence a person says when they are a beat away from answering.
 *
 * Spoken by `withToolBridge` while a lookup is genuinely still running, never
 * on a fast one — which is the whole reason this is scheduled by code rather
 * than left to the model. A model asked to "say something before you look
 * things up" says it every single time, including on a cache hit that returns
 * in milliseconds, and a bridge that lands on top of its own answer is just a
 * new robotic tic in place of the old one.
 *
 * Content-free on purpose, like `buildIdleNudgeInstructions`: a canned filler
 * string is exactly the fake-sounding line we are trying to get rid of.
 *
 * @param {{ step?: number }} [ctx] how many bridges have already been spoken
 *   during this one tool call (0 = this is the first)
 * @returns {string|null} null once it would start sounding like stalling
 */
export function buildLookupBridgeInstructions({ step = 0 } = {}) {
    if (step === 0) {
        return [
            'The visitor is waiting on you for a moment.',
            'Say one very short, natural thing to hold the moment — the kind of half-sentence a person says when they are just about to answer. Two or three words is plenty.',
            'Do not describe what you are doing, do not mention finding or checking anything, and do not begin the answer yet.',
            'Do not call any tools.'
        ].join(' ');
    }

    if (step === 1) {
        return [
            'It is taking longer than you expected.',
            'One more short line, in different words from the one you just used, that acknowledges the wait without explaining it.',
            'Do not call any tools.'
        ].join(' ');
    }

    // Past two, more talking reads as stalling. Silence is the better answer.
    return null;
}

/**
 * The opening line, when there is no presentation to run.
 *
 * Lived inline in agent-worker as a hardcoded string, which made it a third
 * source of voice alongside this module and the persona — and it read like a
 * receptionist script. Same content-free shape as the rest of this file.
 *
 * @returns {string}
 */
export function buildGreetingInstructions() {
    return [
        'Open the conversation: one short, warm line, then hand it back to them.',
        'Do not announce your job title, do not read out a list of what you can help with, and do not sound like a script.',
        'Do not call any tools.'
    ].join(' ');
}
