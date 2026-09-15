-- Reconcile databases created by the earlier auth migration while remaining a
-- no-op for fresh databases created by 20260909104546_init.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN DEFAULT false;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "username" TEXT;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "displayUsername" TEXT;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" TEXT;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banned" BOOLEAN DEFAULT false;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banReason" TEXT;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banExpires" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "user_username_key" ON "user"("username");

CREATE TABLE IF NOT EXISTS "twoFactor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN DEFAULT true,
    "failedVerificationCount" INTEGER DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    CONSTRAINT "twoFactor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "twoFactor_secret_idx" ON "twoFactor"("secret");
CREATE INDEX IF NOT EXISTS "twoFactor_userId_idx" ON "twoFactor"("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'twoFactor_userId_fkey') THEN
    ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "issuer" TEXT;
UPDATE "account" SET "issuer" = "providerId" WHERE "issuer" IS NULL;
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "account_issuer_accountId_uidx" ON "account"("issuer", "accountId");
