ALTER TABLE "order_legal_snapshots"
ADD COLUMN "distanceSalesVersion" TEXT,
ADD COLUMN "preInformationVersion" TEXT,
ADD COLUMN "distanceSalesHash" TEXT,
ADD COLUMN "preInformationHash" TEXT,
ADD COLUMN "acceptedDistanceSalesAt" TIMESTAMP(3),
ADD COLUMN "acceptedPreInformationAt" TIMESTAMP(3),
ADD COLUMN "acceptedIp" TEXT,
ADD COLUMN "acceptedUserAgent" TEXT,
ADD COLUMN "acceptedSessionId" TEXT;
