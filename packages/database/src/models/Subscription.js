import { Schema, model } from 'mongoose';

const SubscriptionSchema = new Schema(
    {
        workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true, index: true },
        planKey: { type: String, required: true, default: 'free', index: true },
        stripeCustomerId: { type: String, default: null },
        stripeSubId: { type: String, default: null },
        status: {
            type: String,
            enum: ['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete'],
            default: 'active',
            index: true
        },
        currentPeriodStart: { type: Date, default: Date.now },
        currentPeriodEnd: {
            type: Date,
            default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        },
        cancelAtPeriodEnd: { type: Boolean, default: false },
        usage: {
            agentVoiceMinutes: { type: Number, default: 0 },
            avatarSeconds: { type: Number, default: 0 },
            ingestionUnits: { type: Number, default: 0 },
            tourBrowserMinutes: { type: Number, default: 0 },
            visionFrames: { type: Number, default: 0 }
        }
    },
    { timestamps: true }
);

export const Subscription = model('Subscription', SubscriptionSchema);
