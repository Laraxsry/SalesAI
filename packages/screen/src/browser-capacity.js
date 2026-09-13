function configuredLimit() {
    const value = Number(process.env.MAX_TOUR_BROWSERS || 3);
    return Number.isInteger(value) && value > 0 ? value : 3;
}

/** Process-local admission control shared by every browser driver. */
export class BrowserCapacity {
    constructor({ limit = configuredLimit() } = {}) {
        this.limit = limit;
        this.leases = new Set();
    }

    acquire(owner, label = 'Browser') {
        if (this.leases.has(owner)) return;
        if (this.leases.size >= this.limit) {
            throw new Error(
                `[${label}] Concurrent browser limit reached (${this.limit}). ` +
                'Try again later or increase MAX_TOUR_BROWSERS env var.'
            );
        }
        this.leases.add(owner);
    }

    release(owner) {
        this.leases.delete(owner);
    }
}

export const tourBrowserCapacity = new BrowserCapacity();
