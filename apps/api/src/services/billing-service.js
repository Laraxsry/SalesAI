import { Plan, Subscription, UsageRecord } from '@repo/database';
import { Logger } from '@repo/logger';

/** Default Plan Definitions */
export const DEFAULT_PLANS = [
    {
        key: 'free',
        name: 'Free Plan',
        priceMonthly: 0,
        priceYearly: 0,
        stripePriceId: process.env.STRIPE_PRICE_FREE || null,
        quotas: {
            agentVoiceMinutes: 30,
            avatarSeconds: 0,
            ingestionUnits: 50,
            tourBrowserMinutes: 15,
            visionFrames: 100,
            seats: 2
        },
        features: {
            allowedAvatarProviders: ['default'],
            allowedScreenModes: ['dom'],
            seats: 2,
            embedDomains: 1,
            apiAccess: false
        }
    },
    {
        key: 'pro',
        name: 'Pro Plan',
        priceMonthly: 49,
        priceYearly: 470,
        stripePriceId: process.env.STRIPE_PRICE_PRO || null,
        quotas: {
            agentVoiceMinutes: 500,
            avatarSeconds: 600,
            ingestionUnits: 1000,
            tourBrowserMinutes: 120,
            visionFrames: 2000,
            seats: 10
        },
        features: {
            allowedAvatarProviders: ['default', 'heygen', 'tavus', 'synthesia'],
            allowedScreenModes: ['dom', 'vision'],
            seats: 10,
            embedDomains: 10,
            apiAccess: true
        }
    },
    {
        key: 'scale',
        name: 'Scale Plan',
        priceMonthly: 199,
        priceYearly: 1900,
        stripePriceId: process.env.STRIPE_PRICE_SCALE || null,
        quotas: {
            agentVoiceMinutes: 2500,
            avatarSeconds: 3600,
            ingestionUnits: 10000,
            tourBrowserMinutes: 600,
            visionFrames: 10000,
            seats: 50
        },
        features: {
            allowedAvatarProviders: ['default', 'heygen', 'tavus', 'synthesia'],
            allowedScreenModes: ['dom', 'vision'],
            seats: 50,
            embedDomains: -1, // Unlimited
            apiAccess: true
        }
    }
];

/**
 * Initializes default plans in MongoDB if they do not exist.
 */
export async function ensureDefaultPlans() {
    try {
        for (const planData of DEFAULT_PLANS) {
            await Plan.updateOne(
                { key: planData.key },
                { $setOnInsert: planData },
                { upsert: true }
            );
        }
    } catch (err) {
        Logger.error('Failed to ensure default plans', { error: err.message });
    }
}

/**
 * Gets or creates the Subscription for a given workspace.
 */
export async function getWorkspaceSubscription(workspaceId) {
    await ensureDefaultPlans();
    let sub = await Subscription.findOne({ workspaceId });
    if (!sub) {
        sub = await Subscription.create({
            workspaceId,
            planKey: 'free',
            status: 'active',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });
    }
    return sub;
}

/** Mapping meter names to Subscription usage object keys */
const METER_MAP = {
    agent_voice_minutes: 'agentVoiceMinutes',
    avatar_seconds: 'avatarSeconds',
    ingestion_units: 'ingestionUnits',
    tour_browser_minutes: 'tourBrowserMinutes',
    vision_frames: 'visionFrames'
};

/**
 * Records a usage event and increments current period aggregate in Subscription.
 */
export async function recordUsage({ workspaceId, meter, quantity, estCost = 0, sessionId = null, agentId = null }) {
    if (!workspaceId || !meter || !quantity) return null;

    const record = await UsageRecord.create({
        workspaceId,
        meter,
        quantity,
        estCost,
        sessionId,
        agentId,
        timestamp: new Date()
    });

    const subKey = METER_MAP[meter] || meter;
    const sub = await getWorkspaceSubscription(workspaceId);

    if (subKey && typeof sub.usage[subKey] !== 'undefined') {
        sub.usage[subKey] = (sub.usage[subKey] || 0) + quantity;
        await sub.save();
    }

    return record;
}

/**
 * Returns detailed usage statistics vs plan quotas for a workspace.
 */
export async function getWorkspaceUsageAndQuotas(workspaceId) {
    const sub = await getWorkspaceSubscription(workspaceId);
    const plan = (await Plan.findOne({ key: sub.planKey })) || DEFAULT_PLANS[0];

    const quotas = plan.quotas || DEFAULT_PLANS[0].quotas;
    const usage = sub.usage || {};

    const formatMeter = (used, quota) => {
        const percentage = quota > 0 ? Number(((used / quota) * 100).toFixed(2)) : 0;
        return {
            used,
            quota,
            percentage,
            isOverQuota: quota > 0 && used >= quota,
            isWarning: quota > 0 && percentage >= 80 && used < quota
        };
    };

    return {
        planKey: sub.planKey,
        planName: plan.name,
        status: sub.status,
        period: {
            start: sub.currentPeriodStart,
            end: sub.currentPeriodEnd
        },
        meters: {
            agentVoiceMinutes: formatMeter(usage.agentVoiceMinutes || 0, quotas.agentVoiceMinutes || 30),
            avatarSeconds: formatMeter(usage.avatarSeconds || 0, quotas.avatarSeconds || 0),
            ingestionUnits: formatMeter(usage.ingestionUnits || 0, quotas.ingestionUnits || 50),
            tourBrowserMinutes: formatMeter(usage.tourBrowserMinutes || 0, quotas.tourBrowserMinutes || 15),
            visionFrames: formatMeter(usage.visionFrames || 0, quotas.visionFrames || 100),
            seats: formatMeter(usage.seats || 1, quotas.seats || 2)
        },
        features: plan.features
    };
}
