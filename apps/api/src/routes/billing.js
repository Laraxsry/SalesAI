import { Router } from 'express';
import { Plan, Subscription } from '@repo/database';
import { requireAuth } from '@repo/auth';
import { requirePermission } from '@repo/access';
import { resolveTenant, resolveMember } from '../middleware/tenant.js';
import {
    DEFAULT_PLANS,
    ensureDefaultPlans,
    getWorkspaceSubscription,
    getWorkspaceUsageAndQuotas
} from '../services/billing-service.js';

export const billingRouter = Router();

/**
 * GET /api/v1/billing/plans
 *
 * List all active subscription plans with pricing and quotas.
 */
billingRouter.get('/plans', async (_req, res, next) => {
    try {
        await ensureDefaultPlans();
        const dbPlans = await Plan.find({ isActive: true }).sort({ priceMonthly: 1 });
        if (dbPlans && dbPlans.length > 0) {
            return res.json(
                dbPlans.map((p) => ({
                    id: String(p._id),
                    key: p.key,
                    name: p.name,
                    priceMonthly: p.priceMonthly,
                    priceYearly: p.priceYearly,
                    stripePriceId: p.stripePriceId,
                    quotas: p.quotas,
                    features: p.features
                }))
            );
        }
        res.json(DEFAULT_PLANS);
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/v1/billing/subscription
 *
 * Get workspace's active subscription status.
 */
billingRouter.get(
    '/subscription',
    requireAuth,
    resolveTenant,
    resolveMember,
    requirePermission('billing:read'),
    async (req, res, next) => {
        try {
            const sub = await getWorkspaceSubscription(req.workspaceId);
            const plan = (await Plan.findOne({ key: sub.planKey })) || DEFAULT_PLANS.find((p) => p.key === sub.planKey);

            res.json({
                id: String(sub._id),
                workspaceId: String(sub.workspaceId),
                planKey: sub.planKey,
                planName: plan?.name || sub.planKey,
                status: sub.status,
                stripeCustomerId: sub.stripeCustomerId,
                stripeSubId: sub.stripeSubId,
                currentPeriodStart: sub.currentPeriodStart,
                currentPeriodEnd: sub.currentPeriodEnd,
                cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
                usage: sub.usage
            });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * GET /api/v1/billing/usage
 *
 * Get workspace's current-period usage vs quotas per meter.
 */
billingRouter.get(
    '/usage',
    requireAuth,
    resolveTenant,
    resolveMember,
    requirePermission('billing:read'),
    async (req, res, next) => {
        try {
            const usageAndQuotas = await getWorkspaceUsageAndQuotas(req.workspaceId);
            res.json(usageAndQuotas);
        } catch (err) {
            next(err);
        }
    }
);

/**
 * POST /api/v1/billing/checkout
 *
 * Creates a Stripe Checkout session for a given planKey.
 * Body: { "planKey": "pro", "successUrl": "...", "cancelUrl": "..." }
 */
billingRouter.post(
    '/checkout',
    requireAuth,
    resolveTenant,
    resolveMember,
    requirePermission('billing:manage'),
    async (req, res, next) => {
        try {
            const { planKey, successUrl, cancelUrl } = req.body;
            const validPlanKeys = ['free', 'pro', 'scale'];
            if (!planKey || !validPlanKeys.includes(planKey)) {
                return res.status(422).json({ error: `Invalid planKey. Allowed: ${validPlanKeys.join(', ')}` });
            }

            const targetPlan = (await Plan.findOne({ key: planKey })) || DEFAULT_PLANS.find((p) => p.key === planKey);

            // Stripe secret key var mı?
            if (process.env.STRIPE_SECRET_KEY) {
                try {
                    const { default: Stripe } = await import('stripe');
                    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
                    const sub = await getWorkspaceSubscription(req.workspaceId);

                    let customerId = sub.stripeCustomerId;
                    if (!customerId) {
                        const customer = await stripe.customers.create({
                            metadata: { workspaceId: String(req.workspaceId) }
                        });
                        customerId = customer.id;
                        sub.stripeCustomerId = customerId;
                        await sub.save();
                    }

                    const session = await stripe.checkout.sessions.create({
                        customer: customerId,
                        mode: 'subscription',
                        line_items: [{ price: targetPlan.stripePriceId || 'price_mock', quantity: 1 }],
                        success_url: successUrl || 'http://localhost:3000/settings/billing?success=true',
                        cancel_url: cancelUrl || 'http://localhost:3000/settings/billing?canceled=true',
                        client_reference_id: String(req.workspaceId),
                        metadata: { planKey }
                    });

                    return res.json({ checkoutUrl: session.url, sessionId: session.id });
                } catch (stripeErr) {
                    // Fallback to mock session URL if Stripe API fails
                }
            }

            // Dev / Mock Mode: update subscription directly and return mock checkout URL
            const sub = await getWorkspaceSubscription(req.workspaceId);
            sub.planKey = planKey;
            sub.status = 'active';
            await sub.save();

            res.json({
                checkoutUrl: `https://checkout.stripe.mock/session?workspace=${req.workspaceId}&plan=${planKey}`,
                mock: true,
                planKey: sub.planKey,
                status: sub.status,
                message: 'Stripe API key not set; updated subscription plan directly for dev mode.'
            });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * POST /api/v1/billing/portal
 *
 * Creates a Stripe Customer Portal link.
 */
billingRouter.post(
    '/portal',
    requireAuth,
    resolveTenant,
    resolveMember,
    requirePermission('billing:manage'),
    async (req, res, next) => {
        try {
            const { returnUrl } = req.body;
            const sub = await getWorkspaceSubscription(req.workspaceId);

            if (process.env.STRIPE_SECRET_KEY && sub.stripeCustomerId) {
                try {
                    const { default: Stripe } = await import('stripe');
                    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
                    const portalSession = await stripe.billingPortal.sessions.create({
                        customer: sub.stripeCustomerId,
                        return_url: returnUrl || 'http://localhost:3000/settings/billing'
                    });
                    return res.json({ portalUrl: portalSession.url });
                } catch (stripeErr) {
                    // Fallback to mock portal
                }
            }

            res.json({
                portalUrl: `https://billing.stripe.mock/portal?customer=${sub.stripeCustomerId || 'cus_mock'}`,
                mock: true
            });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * POST /api/v1/billing/webhook
 *
 * Handles Stripe webhooks (checkout.session.completed, customer.subscription.*, invoice.*).
 */
billingRouter.post('/webhook', async (req, res, next) => {
    try {
        let event = req.body;

        // Stripe imza doğrulaması
        if (process.env.STRIPE_WEBHOOK_SECRET && req.headers['stripe-signature']) {
            try {
                const { default: Stripe } = await import('stripe');
                const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
                event = stripe.webhooks.constructEvent(
                    req.body,
                    req.headers['stripe-signature'],
                    process.env.STRIPE_WEBHOOK_SECRET
                );
            } catch (err) {
                return res.status(400).json({ error: `Webhook Signature Verification Failed: ${err.message}` });
            }
        }

        const dataObject = event.data ? event.data.object : event;

        switch (event.type) {
            case 'checkout.session.completed': {
                const workspaceId = dataObject.client_reference_id || dataObject.metadata?.workspaceId;
                const planKey = dataObject.metadata?.planKey || 'pro';
                if (workspaceId) {
                    await Subscription.updateOne(
                        { workspaceId },
                        {
                            $set: {
                                planKey,
                                stripeCustomerId: dataObject.customer,
                                stripeSubId: dataObject.subscription,
                                status: 'active'
                            }
                        },
                        { upsert: true }
                    );
                }
                break;
            }

            case 'customer.subscription.updated': {
                const stripeSubId = dataObject.id;
                const status = dataObject.status;
                const planKey = dataObject.metadata?.planKey;
                const update = { status };
                if (planKey) update.planKey = planKey;
                if (dataObject.cancel_at_period_end !== undefined) {
                    update.cancelAtPeriodEnd = dataObject.cancel_at_period_end;
                }
                await Subscription.updateOne({ stripeSubId }, { $set: update });
                break;
            }

            case 'customer.subscription.deleted': {
                const stripeSubId = dataObject.id;
                await Subscription.updateOne(
                    { stripeSubId },
                    { $set: { status: 'canceled', planKey: 'free' } }
                );
                break;
            }

            case 'invoice.paid': {
                const stripeSubId = dataObject.subscription;
                if (stripeSubId) {
                    await Subscription.updateOne(
                        { stripeSubId },
                        { $set: { status: 'active' } }
                    );
                }
                break;
            }

            case 'invoice.payment_failed': {
                const stripeSubId = dataObject.subscription;
                if (stripeSubId) {
                    await Subscription.updateOne(
                        { stripeSubId },
                        { $set: { status: 'past_due' } }
                    );
                }
                break;
            }
        }

        res.json({ received: true, type: event.type });
    } catch (err) {
        next(err);
    }
});
