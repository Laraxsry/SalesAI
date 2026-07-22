import { Schema, model } from 'mongoose';

const UserSchema = new Schema(
    {
        email: { type: String, required: true, unique: true, lowercase: true, index: true },
        passwordHash: { type: String, required: true },
        name: { type: String, required: true },
        avatarUrl: { type: String },
        emailVerified: { type: Boolean, default: false },
        // Phase 8: TOTP 2FA
        twoFactorSecret: { type: String, default: null },   // Encrypted TOTP secret (speakeasy)
        twoFactorEnabled: { type: Boolean, default: false },
        backupCodes: { type: [String], default: [] }        // 8 adet tek kullanımlık recovery kodu (hashed)
    },
    { timestamps: true }
);

export const User = model('User', UserSchema);

