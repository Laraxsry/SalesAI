import { Schema, model } from 'mongoose';

const UserSchema = new Schema(
    {
        email: { type: String, required: true, unique: true, lowercase: true, index: true },
        passwordHash: { type: String, required: true },
        name: { type: String, required: true },
        avatarUrl: { type: String },
        emailVerified: { type: Boolean, default: false }
    },
    { timestamps: true }
);

export const User = model('User', UserSchema);
