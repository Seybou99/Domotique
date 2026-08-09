-- CreateEnum
CREATE TYPE "HomeRole" AS ENUM ('owner', 'admin', 'member', 'guest');

-- CreateEnum
CREATE TYPE "Protocol" AS ENUM ('zigbee', 'tuya', 'hue', 'tapo');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('pending', 'queued', 'sent', 'acked', 'timeout', 'failed');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('running', 'success', 'partial', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "homes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_members" (
    "homeId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "HomeRole" NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3),

    CONSTRAINT "home_members_pkey" PRIMARY KEY ("homeId","userId")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "homeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_units" (
    "id" UUID NOT NULL,
    "homeId" UUID NOT NULL,
    "serial" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "certFingerprint" TEXT,
    "certExpiresAt" TIMESTAMP(3),
    "online" BOOLEAN NOT NULL DEFAULT false,
    "lastHeartbeat" TIMESTAMP(3),
    "agentVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_claims" (
    "unitId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "unit_claims_pkey" PRIMARY KEY ("unitId")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "homeId" UUID NOT NULL,
    "roomId" UUID,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "protocol" "Protocol" NOT NULL,
    "externalId" TEXT NOT NULL,
    "unitId" UUID,
    "accountId" UUID,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "lastSeen" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capabilities" (
    "deviceId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "writable" BOOLEAN NOT NULL,
    "min" DOUBLE PRECISION,
    "max" DOUBLE PRECISION,
    "step" DOUBLE PRECISION,
    "unit" TEXT NOT NULL DEFAULT 'none',
    "snapshotValue" JSONB,
    "snapshotUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "capabilities_pkey" PRIMARY KEY ("deviceId","type")
);

-- CreateTable
CREATE TABLE "commands" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "CommandStatus" NOT NULL DEFAULT 'pending',
    "ackSemantics" TEXT NOT NULL,
    "timeoutMs" INTEGER NOT NULL,
    "issuedByUserId" UUID,
    "issuedByAutomationId" UUID,
    "errorCode" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackedAt" TIMESTAMP(3),

    CONSTRAINT "commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "state_changes" (
    "id" BIGSERIAL NOT NULL,
    "deviceId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "originKind" TEXT NOT NULL,
    "originId" UUID,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "state_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "third_party_accounts" (
    "id" UUID NOT NULL,
    "homeId" UUID NOT NULL,
    "provider" "Protocol" NOT NULL,
    "accountLabel" TEXT NOT NULL,
    "accessTokenEnc" BYTEA NOT NULL,
    "refreshTokenEnc" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "reauthRequired" BOOLEAN NOT NULL DEFAULT false,
    "linkedByUserId" UUID NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "third_party_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" UUID NOT NULL,
    "homeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "triggerKind" TEXT NOT NULL,
    "trigger" JSONB NOT NULL,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "automationId" UUID NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "RunStatus" NOT NULL DEFAULT 'running',
    "failedDeviceIds" UUID[],

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "homeId" UUID NOT NULL,
    "deviceId" UUID,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "homeId" UUID NOT NULL,
    "byCategory" JSONB NOT NULL,
    "deviceOverrides" JSONB NOT NULL,
    "quietHours" JSONB,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("homeId")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "home_members_userId_idx" ON "home_members"("userId");

-- CreateIndex
CREATE INDEX "rooms_homeId_sortOrder_idx" ON "rooms"("homeId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "device_units_serial_key" ON "device_units"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "device_units_certFingerprint_key" ON "device_units"("certFingerprint");

-- CreateIndex
CREATE INDEX "device_units_homeId_idx" ON "device_units"("homeId");

-- CreateIndex
CREATE INDEX "devices_homeId_roomId_idx" ON "devices"("homeId", "roomId");

-- CreateIndex
CREATE UNIQUE INDEX "devices_homeId_protocol_externalId_key" ON "devices"("homeId", "protocol", "externalId");

-- CreateIndex
CREATE INDEX "commands_deviceId_issuedAt_idx" ON "commands"("deviceId", "issuedAt");

-- CreateIndex
CREATE INDEX "commands_status_issuedAt_idx" ON "commands"("status", "issuedAt");

-- CreateIndex
CREATE INDEX "state_changes_deviceId_at_idx" ON "state_changes"("deviceId", "at");

-- CreateIndex
CREATE INDEX "third_party_accounts_homeId_idx" ON "third_party_accounts"("homeId");

-- CreateIndex
CREATE UNIQUE INDEX "third_party_accounts_homeId_provider_accountLabel_key" ON "third_party_accounts"("homeId", "provider", "accountLabel");

-- CreateIndex
CREATE INDEX "automations_homeId_idx" ON "automations"("homeId");

-- CreateIndex
CREATE INDEX "automation_runs_automationId_startedAt_idx" ON "automation_runs"("automationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_automationId_scheduledFor_key" ON "automation_runs"("automationId", "scheduledFor");

-- CreateIndex
CREATE INDEX "alerts_homeId_createdAt_idx" ON "alerts"("homeId", "createdAt");

-- CreateIndex
CREATE INDEX "alerts_homeId_read_idx" ON "alerts"("homeId", "read");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");

-- CreateIndex
CREATE INDEX "push_tokens_userId_idx" ON "push_tokens"("userId");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_members" ADD CONSTRAINT "home_members_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_members" ADD CONSTRAINT "home_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_units" ADD CONSTRAINT "device_units_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_claims" ADD CONSTRAINT "unit_claims_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "device_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "device_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "third_party_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commands" ADD CONSTRAINT "commands_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "third_party_accounts" ADD CONSTRAINT "third_party_accounts_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "third_party_accounts" ADD CONSTRAINT "third_party_accounts_linkedByUserId_fkey" FOREIGN KEY ("linkedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
