-- CreateTable
CREATE TABLE "native_sdk_accounts" (
    "userId" UUID NOT NULL,
    "provider" "Protocol" NOT NULL,
    "uid" TEXT NOT NULL,
    "passwordEnc" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "countryCode" TEXT NOT NULL DEFAULT '33',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "native_sdk_accounts_pkey" PRIMARY KEY ("userId","provider")
);

-- CreateIndex
CREATE UNIQUE INDEX "native_sdk_accounts_uid_key" ON "native_sdk_accounts"("uid");

-- AddForeignKey
ALTER TABLE "native_sdk_accounts" ADD CONSTRAINT "native_sdk_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
