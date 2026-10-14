-- CreateTable
CREATE TABLE "queries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "question" TEXT,
    "sql" TEXT,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "row_count" INTEGER,
    "truncated" TEXT,
    "schema_version" INTEGER,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,
    "models" JSONB NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "llm_ms" INTEGER NOT NULL DEFAULT 0,
    "query_ms" INTEGER NOT NULL DEFAULT 0,
    "total_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "queries_user_id_created_at_id_idx" ON "queries"("user_id", "created_at" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "queries" ADD CONSTRAINT "queries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queries" ADD CONSTRAINT "queries_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

