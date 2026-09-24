import { z } from 'zod';

export const CapturePolicy = z.enum([
    'off',
    'optional',
    'recommended',
    'required_before_close'
]);

const CaptureFieldsInput = z.object({
    name: CapturePolicy.default('optional'),
    email: CapturePolicy.default('recommended'),
    phone: CapturePolicy.default('optional'),
    company: CapturePolicy.default('optional'),
    meetingTime: CapturePolicy.default('optional'),
    companyQuestion: CapturePolicy.default('recommended')
}).strict();

const SchedulingInput = z.object({
    enabled: z.boolean().default(false),
    timezone: z.string().trim().min(1).max(100).default('UTC'),
    durationMinutes: z.number().int().min(5).max(480).default(30)
}).strict().superRefine((value, ctx) => {
    try {
        new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format();
    } catch {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['timezone'],
            message: 'timezone must be a valid IANA timezone'
        });
    }
});

export const ProductEngagementSettingsInput = z.object({
    multiAgentAnalysisEnabled: z.boolean().default(false),
    participantMemoryEnabled: z.boolean().default(false),
    adaptiveSurveyEnabled: z.boolean().default(false),
    dynamicDemoEnabled: z.boolean().default(false),
    leadCaptureEnabled: z.boolean().default(false),
    captureFields: CaptureFieldsInput.default({}),
    scheduling: SchedulingInput.default({})
}).strict();

export const ProductEngagementSettingsRuntimeInput = ProductEngagementSettingsInput.extend({
    schemaVersion: z.literal(1).default(1)
}).strict();
