/**
 * Session-scoped application boundary for browser automation.
 *
 * The worker talks only to this object. The selected driver owns browser
 * mechanics (Playwright today, Chrome MCP next); BrowserSession owns ordering
 * and lifecycle so two control paths can never mutate one browser at once.
 */
export class BrowserSession {
    constructor({ driver, provider = 'playwright' } = {}) {
        if (!driver) throw new TypeError('BrowserSession requires a driver.');
        this.driver = driver;
        this.provider = provider;
        this.state = 'idle';
        this.operationTail = Promise.resolve();
        this.closePromise = null;
    }

    requiresDemoLogin(url) {
        return this.driver.requiresDemoLogin?.(url) ?? false;
    }

    prepare(options) {
        return this.enqueue('prepare', async () => {
            const result = await this.driver.prepare(options);
            if (this.state !== 'open') this.state = 'ready';
            return result;
        });
    }

    open(url) {
        return this.enqueue('open', async () => {
            const result = await this.driver.open(url);
            this.state = 'open';
            return result;
        });
    }

    goto(url) {
        return this.enqueue('goto', () => this.driver.goto(url));
    }

    highlight(selector) {
        return this.enqueue('highlight', () => this.driver.highlight(selector));
    }

    click(selector, options) {
        return this.enqueue('click', () => this.driver.click(selector, options));
    }

    scroll(direction, amount, target) {
        return this.enqueue('scroll', () => this.driver.scroll(direction, amount, target));
    }

    screenshot() {
        return this.enqueue('screenshot', () => this.driver.screenshot());
    }

    observe() {
        return this.enqueue('observe', () => this.driver.observe());
    }

    perform(action, args) {
        return this.enqueue(action, () => this.driver.perform(action, args));
    }

    describeElement(uid) {
        return this.enqueue('describeElement', () => this.driver.describeElement(uid));
    }

    recover() {
        return this.enqueue('recover', async () => {
            if (!this.driver.recover) return false;
            await this.driver.recover();
            this.state = 'idle';
            this.closePromise = null;
            return true;
        });
    }

    close() {
        if (this.closePromise) return this.closePromise;
        if (this.state === 'closed') return Promise.resolve();
        this.state = 'closing';
        this.closePromise = this.enqueue('close', async () => {
            try {
                await this.driver.close();
            } finally {
                this.state = 'closed';
            }
        }, { allowWhenClosed: true });
        return this.closePromise;
    }

    enqueue(label, operation, { allowWhenClosed = false } = {}) {
        if ((this.state === 'closing' || this.state === 'closed') && !allowWhenClosed) {
            return Promise.reject(new Error(`BrowserSession is closed; cannot run ${label}.`));
        }

        const run = async () => {
            if ((this.state === 'closing' || this.state === 'closed') && !allowWhenClosed) {
                throw new Error(`BrowserSession is closed; cannot run ${label}.`);
            }
            return operation();
        };

        const result = this.operationTail.then(run, run);
        // A failed command must not poison the queue. The caller still receives
        // the original rejection through `result`.
        this.operationTail = result.catch(() => {});
        return result;
    }
}
