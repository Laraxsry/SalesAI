import { Sparkle, VoiceOrb } from '@repo/ui';

/** Soft "breathing" level so the orb stays alive outside a call. */
function restingLevel() {
    const t = performance.now() / 1000;
    return 0.12 + 0.06 * Math.sin(t * 1.4);
}

/** The assistant's orb with its glint, as shown on the cards before and after a call. */
export function RestingOrb() {
    return (
        <>
            <span className="orb-badge__spark" aria-hidden="true"><Sparkle size={20} /></span>
            <VoiceOrb size={104} mode="listening" getLevel={restingLevel} label="AI temsilci" />
        </>
    );
}
