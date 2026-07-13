import { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
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
}
