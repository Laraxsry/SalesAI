import { Schema, model } from 'mongoose';

/**
 * Device — an Expo push token registered for a Visitor (Mobile Phase 3).
 * One visitor can have several devices (phone + tablet); the same physical
 * device re-registering with the same token upserts rather than duplicating.
 */
const DeviceSchema = new Schema(
    {
        visitorId: { type: Schema.Types.ObjectId, ref: 'Visitor', required: true, index: true },
        expoPushToken: { type: String, required: true },
        platform: { type: String, enum: ['ios', 'android', 'web'], default: 'ios' },
        lastSeenAt: { type: Date, default: Date.now }
    },
    { timestamps: true }
);

DeviceSchema.index({ visitorId: 1, expoPushToken: 1 }, { unique: true });

export const Device = model('Device', DeviceSchema);
