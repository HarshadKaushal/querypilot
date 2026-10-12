-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "database_name" TEXT NOT NULL,
    "ssl_mode" TEXT NOT NULL,
    "username_ciphertext" TEXT NOT NULL,
    "username_iv" TEXT NOT NULL,
    "username_tag" TEXT NOT NULL,
    "password_ciphertext" TEXT NOT NULL,
    "password_iv" TEXT NOT NULL,
    "password_tag" TEXT NOT NULL,
    "encrypted_data_key" TEXT NOT NULL,
    "data_key_iv" TEXT NOT NULL,
    "data_key_tag" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "last_tested_at" TIMESTAMP(3),
    "send_sample_rows_to_llm" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connections_user_id_idx" ON "connections"("user_id");

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
