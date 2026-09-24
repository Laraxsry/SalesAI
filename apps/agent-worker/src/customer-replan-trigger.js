const ACKNOWLEDGEMENT = /^(evet|hayır|tamam|anladım|peki|olur|okay|ok|yes|no|thanks|teşekkürler)[.!?\s]*$/iu;
const QUESTION_WORD = /\b(nasıl|neden|niçin|hangi|nerede|ne zaman|nedir|neler|kaç|mı|mi|mu|mü|how|what|why|where|when|which|can|could|does|do)\b/iu;
const REQUEST = /\b(göster|gösterebilir|istiyorum|ihtiyacım|yapabilir|destekliyor|çalışıyor|show|need|want|support)\b/iu;

/** Cheap reconsideration policy; only explicit questions and requests start retrieval. */
export function shouldReplanForUtterance(value) {
    const text = String(value ?? '').trim();
    if (text.length < 5 || ACKNOWLEDGEMENT.test(text)) return false;
    return text.includes('?') || QUESTION_WORD.test(text) || REQUEST.test(text);
}

/** Keeps late retrievals and duplicate tool lookups from replacing a newer route. */
export function createCustomerReplanTrigger({ resolve, onResolution, onError = () => {} }) {
    let generation = 0;
    let plannedIntentIds = new Set();

    async function accept(resolution, currentGeneration) {
        if (currentGeneration !== generation || !resolution?.intentId
            || plannedIntentIds.has(resolution.intentId)) return false;
        plannedIntentIds.add(resolution.intentId);
        await onResolution(resolution);
        return true;
    }

    return {
        onUtterance(text, productId) {
            const currentGeneration = ++generation;
            plannedIntentIds = new Set();
            if (!shouldReplanForUtterance(text)) return Promise.resolve(false);
            return Promise.resolve().then(() => resolve({ productId, query: text }))
                .then((resolution) => accept(resolution, currentGeneration))
                .catch((error) => { onError(error); return false; });
        },
        onToolResolution(resolution) {
            return accept(resolution, generation).catch((error) => {
                onError(error);
                return false;
            });
        }
    };
}
