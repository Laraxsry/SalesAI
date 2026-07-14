import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the root .env FIRST
dotenv.config({ path: path.join(__dirname, '.env') });

// THEN import storage (so it sees process.env)
const { presignUpload } = await import('./packages/storage/src/index.js');
const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');

const dummyPdfContent = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT\n/F1 24 Tf\n100 700 Td\n(Hello World) Tj\nET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000219 00000 n \n0000000314 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n402\n%%EOF\n');
fs.writeFileSync('dummy.pdf', dummyPdfContent);

const s3Client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
    region: process.env.S3_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin'
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
});

async function run() {
    try {
        console.log('Using endpoint:', process.env.S3_ENDPOINT);
        console.log('Generating presigned URL...');
        const fileKey = 'test-uploads/dummy.pdf';
        const url = await presignUpload(fileKey, 'application/pdf', 300);
        console.log('URL:', url);

        console.log('Uploading dummy.pdf using fetch...');
        const fileData = fs.readFileSync('dummy.pdf');
        
        const uploadRes = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Length': fileData.length.toString()
            },
            body: fileData
        });
        
        if (!uploadRes.ok) {
            throw new Error(`Upload failed: ${uploadRes.status} ${uploadRes.statusText}`);
        }
        console.log('Upload successful!');

        console.log('Downloading file back using S3Client...');
        const getCmd = new GetObjectCommand({
            Bucket: process.env.S3_BUCKET || 'salesai-uploads',
            Key: fileKey
        });

        const getRes = await s3Client.send(getCmd);
        
        const chunks = [];
        for await (const chunk of getRes.Body) {
            chunks.push(chunk);
        }
        const downloadedBuffer = Buffer.concat(chunks);
        
        console.log(`Downloaded size: ${downloadedBuffer.length} bytes`);
        if (downloadedBuffer.length === 0) {
            console.error('ERROR: Downloaded file is 0 bytes!');
        } else if (downloadedBuffer.length === dummyPdfContent.length) {
            console.log('SUCCESS: Downloaded file size matches uploaded file size.');
        } else {
            console.log('WARNING: Downloaded file size differs from uploaded size.');
        }
        
    } catch (err) {
        console.error('Test failed:', err);
    }
}

run();
