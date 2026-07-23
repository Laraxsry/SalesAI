import { Schema, model } from 'mongoose';

/**
 * A job that exhausted every configured BullMQ retry attempt (Phase 7 —
 * "dead-letter queue for poison jobs"). Written by @repo/queue's
 * `createWorker()` so a permanently-failing job is queryable and
 * alertable here, instead of sitting invisibly in BullMQ's own internal
 * failed-job list until someone happens to look.
 */
const DeadLetterJobSchema = new Schema(
    {
        queueName: { type: String, required: true, index: true },
        jobName: { type: String, required: true },
        jobId: { type: String, required: true },
        data: { type: Schema.Types.Mixed },
        failedReason: { type: String },
        attemptsMade: { type: Number },
        failedAt: { type: Date, default: Date.now, index: true }
    },
    { timestamps: true }
);

export const DeadLetterJob = model('DeadLetterJob', DeadLetterJobSchema);
