import { getWorkspaceUsageAndQuotas } from '../services/billing-service.js';

const METER_KEY_MAP = {
    agent_voice_minutes: 'agentVoiceMinutes',
    avatar_seconds: 'avatarSeconds',
    ingestion_units: 'ingestionUnits',
    tour_browser_minutes: 'tourBrowserMinutes',
    vision_frames: 'visionFrames',
    seats: 'seats'
};

/**
 * Middleware factory enforcing quota limits for a given cost driver meter.
 * Returns HTTP 402 Payment Required if workspace has reached or exceeded its quota limit.
 *
 * @param {string} meter - The cost driver meter identifier (e.g. 'agent_voice_minutes')
 */
export function enforceQuota(meter) {
    return async (req, res, next) => {
        try {
            const workspaceId = req.workspaceId || req.body?.workspaceId || req.query?.workspaceId || req.params?.workspaceId;
            if (!workspaceId) {
                // If workspaceId is not available yet in middleware chain, skip enforcement
                return next();
            }

            const usageInfo = await getWorkspaceUsageAndQuotas(workspaceId);
            const meterKey = METER_KEY_MAP[meter] || meter;
            const meterData = usageInfo.meters[meterKey];

            if (meterData) {
                if (meterData.isWarning) {
                    res.setHeader(
                        'X-Quota-Warning',
                        `Quota warning for ${meter}: ${meterData.used}/${meterData.quota} (${meterData.percentage}%)`
                    );
                }

                if (meterData.isOverQuota) {
                    return res.status(402).json({
                        error: 'Quota exceeded',
                        meter,
                        used: meterData.used,
                        quota: meterData.quota,
                        upgradeHint: `Workspace has reached the maximum allowed limit for ${meter}. Upgrade your subscription to continue.`
                    });
                }
            }

            next();
        } catch (err) {
            next(err);
        }
    };
}

/**
 * Middleware enforcing plan-based feature gates (e.g. avatar providers or screen modes).
 */
export function enforceFeatureGate(checkFn) {
    return async (req, res, next) => {
        try {
            const workspaceId = req.workspaceId || req.body?.workspaceId || req.query?.workspaceId;
            if (!workspaceId) return next();

            const usageInfo = await getWorkspaceUsageAndQuotas(workspaceId);
            const isAllowed = checkFn(usageInfo.features, req);

            if (!isAllowed) {
                return res.status(402).json({
                    error: 'Feature not allowed on current plan',
                    planKey: usageInfo.planKey,
                    upgradeHint: 'Please upgrade your workspace plan to access this feature.'
                });
            }

            next();
        } catch (err) {
            next(err);
        }
    };
}
