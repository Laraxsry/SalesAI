/**
 * The raised-hand queue for a group session (Görev #11). A visitor raises
 * their hand to ask for a turn of their own; the agent works through the queue
 * with the `next_participant` tool once it's done with whoever currently has
 * the floor.
 *
 * FIFO, deduped by identity. Pure and dependency-free — unit-tested directly.
 */
export function createHandQueue() {
    /** @type {string[]} identities, in the order they raised their hand */
    let order = [];

    return {
        /** @param {string} identity */
        raise(identity) {
            if (typeof identity !== 'string' || !identity) return;
            if (!order.includes(identity)) order.push(identity);
        },
        /** @param {string} identity */
        lower(identity) {
            order = order.filter((id) => id !== identity);
        },
        /** Identities currently waiting, in order. */
        list() {
            return [...order];
        },
        /** Removes and returns the identity at the front, or null when empty. */
        shift() {
            return order.shift() ?? null;
        },
        get size() {
            return order.length;
        },
        isEmpty() {
            return order.length === 0;
        }
    };
}
