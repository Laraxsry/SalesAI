import { Schema, model } from 'mongoose';

const PlanSchema = new Schema(
    {
        key: { type: String, required: true, unique: true, index: true },
        name: { type: String, required: true },
        stripePriceId: { type: String, default: null },
        quotas: {
            agentVoiceMinutes: { type: Number, default: 30 },
            avatarSeconds: { type: Number, default: 0 },
            ingestionUnits: { type: Number, default: 50 },
            tourBrowserMinutes: { type: Number, default: 15 },
            visionFrames: { type: Number, default: 100 },
            seats: { type: Number, default: 2 }
        },
        features: {
            allowedAvatarProviders: { type: [String], default: ['default'] },
            allowedScreenModes: { type: [String], default: ['dom'] },
            seats: { type: Number, default: 2 },
            embedDomains: { type: Number, default: 1 },
            apiAccess: { type: Boolean, default: false }
        },
        priceMonthly: { type: Number, default: 0 },
        priceYearly: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true }
    },
    { timestamps: true }
);

export const Plan = model('Plan', PlanSchema);
