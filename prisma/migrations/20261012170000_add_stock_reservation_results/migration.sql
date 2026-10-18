ALTER TYPE "OrderStatus" ADD VALUE 'RESERVED';
ALTER TYPE "OrderStatus" ADD VALUE 'STOCK_REJECTED';

CREATE TABLE "InboxEvent" (
    "eventId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateId" UUID,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboxEvent_pkey" PRIMARY KEY ("eventId")
);

CREATE INDEX "InboxEvent_aggregateId_eventType_idx"
ON "InboxEvent"("aggregateId", "eventType");
