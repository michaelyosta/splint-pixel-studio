import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';

const required = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`S3 bucket initialization requires: ${missing.join(', ')}`);

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});

try {
  await client.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
  console.log(`Created bucket ${process.env.S3_BUCKET}`);
} catch (error) {
  if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error.name)) throw error;
  console.log(`Bucket ${process.env.S3_BUCKET} already exists`);
}
