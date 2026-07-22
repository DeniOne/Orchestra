-- CreateTable
CREATE TABLE "SessionRecord" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "currentPhase" TEXT NOT NULL,
    "rounds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionRecord_projectId_idx" ON "SessionRecord"("projectId");

-- CreateIndex
CREATE INDEX "SessionRecord_currentPhase_idx" ON "SessionRecord"("currentPhase");

-- CreateIndex
CREATE INDEX "SessionRecord_updatedAt_idx" ON "SessionRecord"("updatedAt");
