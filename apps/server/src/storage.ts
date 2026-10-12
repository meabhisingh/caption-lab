import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@caption-generator/env/server";
import type { SQLOutputValue } from "node:sqlite";
import { getLocalDatabase, localFilesDir } from "./sqlite";

export type StoredObject = {
  body: Buffer;
  contentType: string;
};

type ObjectStorage = {
  putObject(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType: string,
  ): Promise<void>;
  getObjectBuffer(key: string): Promise<Buffer>;
  getDownloadUrl(key: string, downloadName?: string): Promise<string>;
  read(key: string): Promise<StoredObject>;
};

const asText = (value: SQLOutputValue | undefined) =>
  typeof value === "string" ? value : null;

/**
 * A `Content-Disposition` value for a download. Header values are Latin-1, so
 * the name goes in twice: an ASCII stand-in, and the real name percent-encoded
 * (RFC 5987) for browsers that read it.
 */
export const attachmentDisposition = (name: string) => {
  const clean = name.replace(/[\u0000-\u001f\u007f"\\]/g, "");
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_") || "download";
  const encoded = encodeURIComponent(clean).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
};

const resolveObjectPath = (key: string) => {
  const normalized = key.replaceAll("\\", "/").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error("Invalid storage key.");
  }
  const root = resolve(localFilesDir());
  const full = resolve(root, normalized);
  if (full !== root && !full.startsWith(`${root}${sep}`)) {
    throw new Error("Invalid storage key.");
  }
  return full;
};

const createLocalStorage = (): ObjectStorage => ({
  putObject: async (key, body, contentType) => {
    const path = resolveObjectPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    getLocalDatabase()
      .prepare(
        `INSERT INTO object_meta (key, content_type) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET content_type = excluded.content_type`,
      )
      .run(key, contentType);
  },
  getObjectBuffer: async (key) => readFile(resolveObjectPath(key)),
  getDownloadUrl: async (key, downloadName) => {
    if (env.CAPTIONLAB_RUNTIME !== "desktop") {
      throw new Error(
        "Local downloads are only available in the desktop runtime.",
      );
    }
    const url = new URL(`http://127.0.0.1:${env.PORT}/api/media`);
    url.searchParams.set("key", key);
    if (downloadName) url.searchParams.set("download", downloadName);
    return url.toString();
  },
  read: async (key) => {
    const body = await readFile(resolveObjectPath(key));
    const row = getLocalDatabase()
      .prepare("SELECT content_type FROM object_meta WHERE key = ?")
      .get(key);
    return {
      body,
      contentType: asText(row?.content_type) ?? "application/octet-stream",
    };
  },
});

const createS3Storage = (): ObjectStorage => {
  if (env.CAPTIONLAB_RUNTIME !== "server") {
    throw new Error(
      "Object storage credentials are only used by the hosted API.",
    );
  }
  const storage = new S3Client({
    region: env.STORAGE_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY,
      secretAccessKey: env.AWS_SECRET_KEY,
    },
  });
  const bucket = env.STORAGE_BUCKET;
  return {
    putObject: async (key, body, contentType) => {
      await storage.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    getObjectBuffer: async (key) => {
      const result = await storage.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!result.Body) throw new Error(`Storage object ${key} has no body`);
      return Buffer.from(await result.Body.transformToByteArray());
    },
    getDownloadUrl: (key, downloadName) =>
      getSignedUrl(
        storage,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: downloadName
            ? attachmentDisposition(downloadName)
            : undefined,
        }),
        { expiresIn: 60 * 60 },
      ),
    read: async (key) => {
      const result = await storage.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!result.Body) throw new Error(`Storage object ${key} has no body`);
      return {
        body: Buffer.from(await result.Body.transformToByteArray()),
        contentType: result.ContentType ?? "application/octet-stream",
      };
    },
  };
};

const storage: ObjectStorage =
  env.CAPTIONLAB_RUNTIME === "desktop"
    ? createLocalStorage()
    : createS3Storage();

export const putObject = (
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
) => storage.putObject(key, body, contentType);

export const getObjectBuffer = (key: string) => storage.getObjectBuffer(key);

export const getDownloadUrl = (key: string, downloadName?: string) =>
  storage.getDownloadUrl(key, downloadName);

export const readStoredObject = (key: string) => storage.read(key);
