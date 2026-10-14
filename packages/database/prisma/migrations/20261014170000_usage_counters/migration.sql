-- CreateTable
CREATE TABLE "usage_counters" (
    "user_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "questions" INTEGER NOT NULL DEFAULT 0,
    "rows_returned" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("user_id","day")
);

-- AddForeignKey
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

