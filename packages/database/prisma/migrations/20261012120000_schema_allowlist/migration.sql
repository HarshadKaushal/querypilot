-- CreateTable
CREATE TABLE "schema_snapshots" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "table_count" INTEGER NOT NULL,
    "column_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schema_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allowed_objects" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "schema_name" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "column_name" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allowed_objects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "schema_snapshots_connection_id_version_key" ON "schema_snapshots"("connection_id", "version");

-- CreateIndex
CREATE INDEX "allowed_objects_connection_id_idx" ON "allowed_objects"("connection_id");

-- AddForeignKey
ALTER TABLE "schema_snapshots" ADD CONSTRAINT "schema_snapshots_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allowed_objects" ADD CONSTRAINT "allowed_objects_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

