-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('Goal', 'Requirement', 'Architecture', 'API', 'Module', 'Entity', 'Repository', 'Service', 'Risk', 'Test', 'ADR', 'Task', 'Research', 'Code', 'Documentation', 'Decision');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('depends_on', 'replaces', 'implements', 'validates', 'blocks', 'supersedes', 'conflicts_with', 'references');

-- CreateTable
CREATE TABLE "KgNode" (
    "id" TEXT NOT NULL,
    "type" "NodeType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KgNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KgRelationship" (
    "id" TEXT NOT NULL,
    "type" "RelationshipType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KgRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEventRecord" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainEventRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KgNode_type_idx" ON "KgNode"("type");

-- CreateIndex
CREATE INDEX "KgNode_createdAt_idx" ON "KgNode"("createdAt");

-- CreateIndex
CREATE INDEX "KgRelationship_sourceId_idx" ON "KgRelationship"("sourceId");

-- CreateIndex
CREATE INDEX "KgRelationship_targetId_idx" ON "KgRelationship"("targetId");

-- CreateIndex
CREATE INDEX "KgRelationship_type_idx" ON "KgRelationship"("type");

-- CreateIndex
CREATE INDEX "DomainEventRecord_sessionId_idx" ON "DomainEventRecord"("sessionId");

-- CreateIndex
CREATE INDEX "DomainEventRecord_type_idx" ON "DomainEventRecord"("type");

-- CreateIndex
CREATE INDEX "DomainEventRecord_occurredAt_idx" ON "DomainEventRecord"("occurredAt");

-- AddForeignKey
ALTER TABLE "KgRelationship" ADD CONSTRAINT "KgRelationship_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KgNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KgRelationship" ADD CONSTRAINT "KgRelationship_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "KgNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
