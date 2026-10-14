-- CreateTable
CREATE TABLE "query_cache" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "question_hash" TEXT NOT NULL,
    "sql" TEXT NOT NULL,
    "assumptions" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "query_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "query_cache_connection_id_fingerprint_question_hash_key" ON "query_cache"("connection_id", "fingerprint", "question_hash");

-- AddForeignKey
ALTER TABLE "query_cache" ADD CONSTRAINT "query_cache_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

