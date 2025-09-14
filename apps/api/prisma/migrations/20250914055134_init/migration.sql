-- CreateEnum
CREATE TYPE "public"."subject_type" AS ENUM ('ANNUAL', 'SEMESTRAL', 'SAMINARY');

-- CreateEnum
CREATE TYPE "public"."day_of_week" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "public"."ceitba_branch" AS ENUM ('IT', 'MEDIA', 'INFRASTRUCTURE', 'NAUTICAL', 'EVENTS', 'DIRECTIVES');

-- CreateEnum
CREATE TYPE "public"."ceitba_staff_role" AS ENUM ('PRESIDENT', 'VICEPRESIDENT', 'SECRETARY', 'TREASURER', 'LEADER', 'MEMBER');

-- CreateTable
CREATE TABLE "public"."user" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "file_number" INTEGER,
    "career_id" UUID,
    "plan" VARCHAR(255),
    "name" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "prefered_language" VARCHAR(5) DEFAULT 'es',

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."careers" (
    "id" VARCHAR(25) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "careers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."plan" (
    "id" VARCHAR(25) NOT NULL,
    "career_id" VARCHAR(25) NOT NULL,
    "name" VARCHAR(255),
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."subject" (
    "id" VARCHAR(25) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "credits" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."commission" (
    "id" UUID NOT NULL,
    "subject_code" VARCHAR(10) NOT NULL,
    "commision_name" VARCHAR(10) NOT NULL,
    "course_start" DATE NOT NULL,
    "course_end" DATE NOT NULL,
    "enrolled_students" INTEGER NOT NULL,
    "quota" INTEGER NOT NULL,
    "subject_type" "public"."subject_type" NOT NULL DEFAULT 'SEMESTRAL',

    CONSTRAINT "commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."plan_subject" (
    "dependencies" VARCHAR(255)[],
    "section" VARCHAR(255) NOT NULL,
    "subject_id" VARCHAR(32) NOT NULL,
    "plan_id" VARCHAR(32) NOT NULL,
    "year" INTEGER NOT NULL,
    "semester" INTEGER NOT NULL,
    "credits_required" INTEGER NOT NULL,

    CONSTRAINT "plan_subject_pkey" PRIMARY KEY ("subject_id","plan_id")
);

-- CreateTable
CREATE TABLE "public"."commision_time" (
    "course_id" UUID NOT NULL,
    "day" "public"."day_of_week" NOT NULL,
    "classroom" VARCHAR(50) NOT NULL,
    "building" VARCHAR(50) NOT NULL,
    "hour_from" TIMESTAMPTZ NOT NULL,
    "hour_to" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "commision_time_pkey" PRIMARY KEY ("course_id","day","hour_from")
);

-- CreateTable
CREATE TABLE "public"."ceitba_staff" (
    "user_id" UUID NOT NULL,
    "branch" "public"."ceitba_branch" NOT NULL,
    "role" "public"."ceitba_staff_role" NOT NULL DEFAULT 'MEMBER',
    "start" TIMESTAMPTZ NOT NULL,
    "end" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ceitba_staff_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "public"."user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_file_number_key" ON "public"."user"("file_number");

-- CreateIndex
CREATE INDEX "user_email_idx" ON "public"."user"("email");

-- CreateIndex
CREATE INDEX "user_file_number_idx" ON "public"."user"("file_number");

-- CreateIndex
CREATE INDEX "user_career_id_idx" ON "public"."user"("career_id");

-- CreateIndex
CREATE INDEX "user_plan_idx" ON "public"."user"("plan");

-- CreateIndex
CREATE INDEX "user_name_idx" ON "public"."user"("name");

-- CreateIndex
CREATE INDEX "careers_id_idx" ON "public"."careers"("id");

-- CreateIndex
CREATE INDEX "plan_career_id_idx" ON "public"."plan"("career_id");

-- CreateIndex
CREATE INDEX "subject_id_idx" ON "public"."subject"("id");

-- AddForeignKey
ALTER TABLE "public"."plan" ADD CONSTRAINT "plan_career_id_fkey" FOREIGN KEY ("career_id") REFERENCES "public"."careers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."commision_time" ADD CONSTRAINT "commision_time_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."commission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ceitba_staff" ADD CONSTRAINT "ceitba_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
