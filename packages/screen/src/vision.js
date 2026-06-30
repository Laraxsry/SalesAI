import { describeImage } from '@repo/ai';

/**
 * Customer shared-screen understanding (screen-share mode B).
 *
 * The agent-worker samples ~1 frame/sec from the customer's screen-share track,
 * encodes it as a data URL, and calls this to understand what the customer is
 * looking at so the agent can guide them ("click the blue Settings button...").
 *
 * @param {string} frameDataUrl - data:image/png;base64,... of the current frame
 * @param {string} [question]
 */
export async function analyzeFrame(frameDataUrl, question) {
    const prompt =
        question ||
        'You are guiding a user through this software screen. Describe what is on screen and the next helpful action.';
    return describeImage(frameDataUrl, prompt);
}
