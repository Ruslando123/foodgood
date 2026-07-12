ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "SystemState" (
    "key" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SystemState_pkey" PRIMARY KEY ("key")
);
