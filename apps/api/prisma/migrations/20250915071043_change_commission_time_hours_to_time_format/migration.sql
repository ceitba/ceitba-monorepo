-- Drop the primary key constraint first
ALTER TABLE "commission_time" DROP CONSTRAINT IF EXISTS "commission_time_pkey";

-- AlterTable
ALTER TABLE "commission_time"
ALTER COLUMN "hour_from" TYPE TIME,
ALTER COLUMN "hour_to" TYPE TIME;

-- Recreate the primary key with the new TIME column
ALTER TABLE "commission_time" ADD CONSTRAINT "commission_time_pkey" PRIMARY KEY ("course_id", "day", "hour_from");
