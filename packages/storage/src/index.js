import {
    S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || '',
        secretAccessKey: process.env.S3_SECRET_KEY || ''
    }
});

const BUCKET = process.env.S3_BUCKET || 'salesai-uploads';

/** Uploads a buffer/stream to object storage. */
export function putObject(key, body, contentType) {
    return client.send(
        new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType })
    );
}

/** Creates a presigned URL the browser can use to upload directly. */
export function presignUpload(key, contentType, expiresIn = 900) {
    return getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
        { expiresIn }
    );
}

/** Creates a presigned URL to download/read an object. */
export function presignDownload(key, expiresIn = 900) {
    return getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

export { client as s3, BUCKET };

/** Ensures the default bucket exists. Should be called at boot. */
export async function ensureBucket() {
    try {
        await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
    } catch (err) {
        if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
            await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
            console.log(`[storage] Created bucket: ${BUCKET}`);
        } else {
            throw err;
        }
    }
    await ensureBucketCors();
}

/**
 * Presigned GET/PUT URLs are handed straight to the browser (Console file
 * upload, and the Knowledge detail modal's PDF/image/video preview) — without
 * a CORS policy on the bucket itself the browser blocks the cross-origin
 * fetch before the presigned signature is ever checked ("No
 * 'Access-Control-Allow-Origin' header is present"). This is a property of
 * the S3/MinIO bucket, entirely separate from the Express app's own `cors()`
 * middleware in apps/api/src/main.js — configuring one does nothing for the
 * other. Reuses the same `CORS_ORIGIN` allowlist as that middleware so the
 * two stay in sync; idempotent, safe to re-apply on every boot.
 */
async function ensureBucketCors() {
    const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').filter(Boolean);
    const origins = allowedOrigins.length > 0 ? allowedOrigins : process.env.NODE_ENV === 'production' ? [] : ['*'];
    if (origins.length === 0) return; // prod'da CORS_ORIGIN set edilmemişse hiçbir origin'e izin verme

    try {
        await client.send(
            new PutBucketCorsCommand({
                Bucket: BUCKET,
                CORSConfiguration: {
                    CORSRules: [
                        {
                            AllowedMethods: ['GET', 'PUT', 'HEAD'],
                            AllowedOrigins: origins,
                            AllowedHeaders: ['*'],
                            ExposeHeaders: ['ETag'],
                            MaxAgeSeconds: 3600
                        }
                    ]
                }
            })
        );
    } catch (err) {
        console.warn(
            "[storage] bucket CORS ayarlanamadı (presigned URL'ler tarayıcıdan çalışmayabilir):",
            err.message
        );
    }
}
