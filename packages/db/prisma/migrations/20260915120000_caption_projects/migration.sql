CREATE TYPE "CaptionProjectStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'EXPORTING', 'COMPLETE', 'FAILED');
CREATE TYPE "CaptionMediaType" AS ENUM ('AUDIO', 'VIDEO');

CREATE TABLE "caption_project" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "mediaType" "CaptionMediaType" NOT NULL,
    "status" "CaptionProjectStatus" NOT NULL DEFAULT 'UPLOADED',
    "sourceKey" TEXT NOT NULL,
    "audioKey" TEXT,
    "transcriptKey" TEXT,
    "transcript" JSONB,
    "captionStyle" JSONB NOT NULL,
    "durationSeconds" DOUBLE PRECISION,
    "width" INTEGER NOT NULL DEFAULT 1080,
    "height" INTEGER NOT NULL DEFAULT 1920,
    "fps" INTEGER NOT NULL DEFAULT 30,
    "exportKey" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "caption_project_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "caption_project_userId_idx" ON "caption_project"("userId");
CREATE INDEX "caption_project_status_idx" ON "caption_project"("status");
ALTER TABLE "caption_project" ADD CONSTRAINT "caption_project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
