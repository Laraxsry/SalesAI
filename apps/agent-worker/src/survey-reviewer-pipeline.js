/** Advisory survey reviewers never change a proposal or the deterministic gate. */
export function createSurveyReviewerPipeline({ reviewers = [], timeoutMs = 300 } = {}) {
    return {
        async review(context) {
            const results = [];
            for (const reviewer of reviewers) {
                if (typeof reviewer?.id !== 'string' || typeof reviewer.review !== 'function') {
                    results.push({ id: null, status: 'skipped_invalid_reviewer' });
                    continue;
                }
                let enabled = false;
                try {
                    enabled = typeof reviewer.enabled === 'function'
                        ? reviewer.enabled(context) === true : reviewer.enabled !== false;
                } catch { /* disabled reviewer cannot affect the gate */ }
                if (!enabled) {
                    results.push({ id: reviewer.id, status: 'skipped_disabled' });
                    continue;
                }
                let timer;
                const controller = new AbortController();
                try {
                    const outcome = await Promise.race([
                        Promise.resolve().then(() => reviewer.review(
                            structuredClone(context), { signal: controller.signal }
                        )),
                        new Promise((_, reject) => {
                            timer = setTimeout(() => {
                                controller.abort();
                                reject(new Error('review_timeout'));
                            }, reviewer.timeoutMs ?? timeoutMs);
                        })
                    ]);
                    if (!['passed', 'flagged'].includes(outcome?.status)) {
                        results.push({ id: reviewer.id, status: 'skipped_invalid_output' });
                    } else {
                        results.push(outcome.status === 'flagged'
                            ? { id: reviewer.id, status: 'flagged', reason: outcome.reason ?? null }
                            : { id: reviewer.id, status: 'passed' });
                    }
                } catch (error) {
                    results.push({ id: reviewer.id,
                        status: error?.message === 'review_timeout' ? 'skipped_timeout' : 'skipped_error' });
                } finally {
                    clearTimeout(timer);
                }
            }
            return results;
        }
    };
}
