import mongoose from 'mongoose';

mongoose.set('strictQuery', true);

let connecting = null;

/**
 * Connects to MongoDB (idempotent). Reuses the connection across hot reloads.
 * @param {string} [uri]
 */
export async function connectDB(uri = process.env.MONGODB_URI) {
    if (mongoose.connection.readyState === 1) return mongoose.connection;
    if (connecting) return connecting;
    if (!uri) throw new Error('[database] MONGODB_URI is not set');

    connecting = mongoose
        .connect(uri, { serverSelectionTimeoutMS: 10000 })
        .then(() => mongoose.connection);

    return connecting;
}

export async function disconnectDB() {
    await mongoose.disconnect();
    connecting = null;
}

export { mongoose };
export * from './models/index.js';
