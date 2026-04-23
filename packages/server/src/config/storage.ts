import "dotenv/config";
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

export const storageConfig = {
  endpoint: process.env.MINIO_ENDPOINT ?? "localhost",
  port: Number(process.env.MINIO_PORT ?? 9000),
  accessKey: process.env.MINIO_ACCESS_KEY ?? "minioadmin",
  secretKey: process.env.MINIO_SECRET_KEY ?? "minioadmin",
  bucket: process.env.MINIO_BUCKET ?? "vaults",
  useSSL: process.env.MINIO_USE_SSL === "true",
};

export function createS3Client() {
  return new S3Client({
    endpoint: `${storageConfig.useSSL ? "https" : "http"}://${storageConfig.endpoint}:${storageConfig.port}`,
    region: "us-east-1",
    credentials: {
      accessKeyId: storageConfig.accessKey,
      secretAccessKey: storageConfig.secretKey,
    },
    forcePathStyle: true,
  });
}

// @MX:NOTE S3Client 싱글턴: 런타임 요청에서 연결 풀링을 위해 재사용 (REQ-SRV-001)
let s3Client: S3Client | null = null;

/** 싱글턴 S3Client 반환: 최초 호출 시 생성, 이후 동일 인스턴스 재사용 */
export function getStorageClient(): S3Client {
  if (!s3Client) {
    s3Client = createS3Client();
  }
  return s3Client;
}

/** 테스트 환경에서 싱글턴 초기화 (새 인스턴스 강제 생성) */
export function resetStorageClient(): void {
  s3Client = null;
}

export async function ensureBucket(s3?: S3Client) {
  const client = s3 ?? createS3Client();
  try {
    await client.send(new HeadBucketCommand({ Bucket: storageConfig.bucket }));
  } catch {
    await client.send(
      new CreateBucketCommand({ Bucket: storageConfig.bucket }),
    );
  }
}

// S3에 객체 업로드
export async function putObject(
  key: string,
  body: Buffer | string,
  s3?: S3Client,
) {
  const client = s3 ?? getStorageClient();
  await client.send(
    new PutObjectCommand({
      Bucket: storageConfig.bucket,
      Key: key,
      Body: typeof body === "string" ? Buffer.from(body) : body,
    }),
  );
}

// S3에서 객체 다운로드
export async function getObject(
  key: string,
  s3?: S3Client,
): Promise<Buffer> {
  const client = s3 ?? getStorageClient();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: storageConfig.bucket,
      Key: key,
    }),
  );

  if (!response.Body) {
    throw new Error(`Object not found: ${key}`);
  }

  const chunks: Uint8Array[] = [];
  const stream = response.Body as NodeJS.ReadableStream;
  for await (const chunk of stream) {
    chunks.push(chunk as Uint8Array);
  }
  return Buffer.concat(chunks);
}

// S3에서 객체 삭제
export async function deleteObject(
  key: string,
  s3?: S3Client,
): Promise<void> {
  const client = s3 ?? getStorageClient();
  await client.send(
    new DeleteObjectCommand({
      Bucket: storageConfig.bucket,
      Key: key,
    }),
  );
}
