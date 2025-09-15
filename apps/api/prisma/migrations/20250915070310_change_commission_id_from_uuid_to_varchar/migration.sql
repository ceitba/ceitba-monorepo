/*
  Warnings:

  - The primary key for the `commission` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `commission_time` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Changed the type of `id` on the `commission` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `course_id` on the `commission_time` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "public"."commission_time" DROP CONSTRAINT "commission_time_course_id_fkey";

-- AlterTable
ALTER TABLE "public"."commission" DROP CONSTRAINT "commission_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" VARCHAR(20) NOT NULL,
ADD CONSTRAINT "commission_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "public"."commission_time" DROP CONSTRAINT "commission_time_pkey",
DROP COLUMN "course_id",
ADD COLUMN     "course_id" VARCHAR(20) NOT NULL,
ADD CONSTRAINT "commission_time_pkey" PRIMARY KEY ("course_id", "day", "hour_from");

-- AddForeignKey
ALTER TABLE "public"."commission_time" ADD CONSTRAINT "commission_time_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."commission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
