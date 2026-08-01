import { createReadStream } from 'node:fs';
import { openai } from './openai-client.js';

const VISION_MODEL = () => process.env.OPENAI_LLM_MODEL || 'gpt-5.1';

/**
 * Produces a rich text description of an image (for RAG ingestion of screenshots,
 * diagrams, product photos). Accepts a public/presigned URL or data URL.
 */
export async function describeImage(imageUrl, prompt = 'Describe this image in detail for search.') {
    const res = await openai().chat.completions.create({
        model: VISION_MODEL(),
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: imageUrl } }
                ]
            }
        ]
    });
    return res.choices[0]?.message?.content || '';
}

/** Transcribes an audio/video file (extract audio first for video). */
export async function transcribeAudio(filePath) {
    // gpt-4o-transcribe only supports 'json'/'text' response formats
    // (unlike whisper-1, it rejects 'verbose_json').
    const res = await openai().audio.transcriptions.create({
        file: createReadStream(filePath),
        model: 'gpt-4o-transcribe',
        response_format: 'json'
    });
    return res;
}
