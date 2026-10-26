/**
 * Which shelf a chunk lives on.
 *
 * - knowledge (the default, no `kind` stored): verified facts about the
 *   product. Answers visitor questions.
 * - ui: how the product's own dashboard looks and works (menus, pages,
 *   buttons) crawled from a logged-in demo workspace. Used to navigate and
 *   demonstrate; never quoted as product facts — the demo workspace's own
 *   example data ("Credits used $0.11") is not a price list.
 *
 * Chunks written before this field existed carry no `kind` and count as
 * knowledge, so nothing needs migrating.
 */
export const UI_KIND = 'ui';

/** @typedef {'knowledge'|'ui'|'all'} KindScope */

/**
 * @param {string|undefined} chunkKind the stored `kind` of a chunk
 * @param {KindScope} [scope]
 */
export function inKindScope(chunkKind, scope = 'knowledge') {
    if (scope === 'all') return true;
    return scope === UI_KIND ? chunkKind === UI_KIND : chunkKind !== UI_KIND;
}
