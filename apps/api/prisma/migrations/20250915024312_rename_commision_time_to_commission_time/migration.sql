/*
  Warnings:

  - You are about to drop the column `commision_name` on the `commission` table. All the data in the column will be lost.
  - You are about to drop the `commision_time` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `commission_name` to the `commission` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."commision_time" DROP CONSTRAINT "commision_time_course_id_fkey";

-- AlterTable
ALTER TABLE "public"."commission" DROP COLUMN "commision_name",
ADD COLUMN     "commission_name" VARCHAR(10) NOT NULL;

-- DropTable
DROP TABLE "public"."commision_time";

-- CreateTable
CREATE TABLE "public"."commission_time" (
    "course_id" UUID NOT NULL,
    "day" "public"."day_of_week" NOT NULL,
    "classroom" VARCHAR(50) NOT NULL,
    "building" VARCHAR(50) NOT NULL,
    "hour_from" TIMESTAMPTZ NOT NULL,
    "hour_to" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "commission_time_pkey" PRIMARY KEY ("course_id","day","hour_from")
);

-- AddForeignKey
ALTER TABLE "public"."commission_time" ADD CONSTRAINT "commission_time_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."commission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
