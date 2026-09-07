/** Preserve the browser's result all the way back to click_element. Only
 * publish a fresh frame and a success audit entry after a successful click. */
export async function clickAndSyncTour(tour, selector, options, onSuccess) {
    const result = await tour.click(selector, options);
    if (!result?.ok) return result ?? { ok: false, reason: 'missing_click_result' };
    await onSuccess(result);
    return result;
}
