import { Router } from 'express';
import { validate } from '@repo/validation';
import { DeviceRegisterInput } from '@repo/contracts';
import { Visitor, Device } from '@repo/database';
import { requestTimeout } from '../middleware/request-timeout.js';
import { lightPublicRateLimit } from '../middleware/public-rate-limits.js';

export const devicesRouter = Router();

/**
 * Mobile Phase 3: establishes a visitor identity and (optionally) registers
 * an Expo push token for it.
 *
 * Public (no auth) — per md/mobile/phase3_push_saved.md, push identity is
 * "anonymous device identity by default": a visitor shouldn't need to sign
 * in via magic-link just to receive follow-up notifications. If `visitorId`
 * is omitted or unknown, a new anonymous Visitor is minted and returned so
 * the app can persist it locally; a later POST /auth/magic-link with that
 * same visitorId upgrades it to an email identity without losing history.
 *
 * `expoPushToken` is optional so the app can call this once on first launch
 * (just to get a visitorId to tag sessions with) and again later, with a
 * real token, once the user actually grants push permission.
 *
 * POST /api/v1/devices
 */
devicesRouter.post('/', lightPublicRateLimit, requestTimeout(5000), validate({ body: DeviceRegisterInput }), async (req, res, next) => {
    try {
        const { visitorId, expoPushToken, platform } = req.body;

        let visitor = visitorId && visitorId.match(/^[0-9a-fA-F]{24}$/)
            ? await Visitor.findById(visitorId)
            : null;
        if (!visitor) visitor = await Visitor.create({});

        let deviceId;
        if (expoPushToken) {
            const device = await Device.findOneAndUpdate(
                { visitorId: visitor._id, expoPushToken },
                { platform, lastSeenAt: new Date() },
                { new: true, upsert: true, setDefaultsOnInsert: true }
            );
            deviceId = String(device._id);
        }

        res.status(201).json({
            visitorId: String(visitor._id),
            ...(deviceId ? { deviceId } : {})
        });
    } catch (err) {
        next(err);
    }
});
