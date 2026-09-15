import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@caption-generator/env/server";

const storage = new S3Client({
  region: env.STORAGE_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY,
    secretAccessKey: env.AWS_SECRET_KEY,
  },
});

export const putObject = async (
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
) => {
  await storage.send(
    new PutObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
};

export const getObjectBuffer = async (key: string) => {
  const result = await storage.send(
    new GetObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: key }),
  );
  if (!result.Body) throw new Error(`Storage object ${key} has no body`);
  return Buffer.from(await result.Body.transformToByteArray());
};

export const getDownloadUrl = (key: string, downloadName?: string) =>
  getSignedUrl(
    storage,
    new GetObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: key,
      ResponseContentDisposition: downloadName
        ? `attachment; filename="${downloadName.replaceAll('"', "")}"`
        : undefined,
    }),
    { expiresIn: 60 * 60 },
  );
