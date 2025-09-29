import { Module } from "@nestjs/common";
import { CareerController } from "../controllers/career.controller";
import { ClassroomController } from "../controllers/classroom.controller";
import { SubjectController } from "../controllers/subject.controller";
import { SubjectPlanController } from "../controllers/subject-plan.controller";
import { DataSyncController } from "../controllers/data-sync.controller";

import { CareerService } from "@/domain/itba/services/career.service";
import { ClassroomService } from "@/domain/itba/services/classroom.service";
import { SubjectPlanService } from "@/domain/itba/services/subject-plan.service";
import { SubjectService } from "@/domain/itba/services/subject.service";
import { CommissionServiceImpl } from "@/domain/itba/services/commission.service";
import { DataSyncService } from "@/domain/itba/services/data-sync.service";

import { CareerRepositoryImpl } from "@/domain/itba/repositories/career.repository.impl";
import { ClassroomRepositoryImpl } from "@/domain/itba/repositories/classroom.repository.impl";
import { SubjectPlanRepositoryImpl } from "@/domain/itba/repositories/subject-plan.repository.impl";
import { SubjectRepositoryImpl } from "@/domain/itba/repositories/subject.repository.impl";
import { CommissionRepositoryImpl } from "@/domain/itba/repositories/commission.repository.impl";
import { ItbaApiServiceImpl } from "@/domain/itba/repositories/itba-api.service.impl";

import { PrismaService } from "@/shared/database/prisma.service";
import { CronService } from "@/shared/services/cron.service";
import { ApiFactory } from "@/shared/external-apis";

import { WikiBookmarkController } from '../controllers/wiki-bookmark.controller';
import { WikiBookmarkService } from '@/domain/itba/services/wiki-bookmark.service';

import {
  CAREER_REPOSITORY,
  CLASSROOM_REPOSITORY,
  SUBJECT_REPOSITORY,
  SUBJECT_PLAN_REPOSITORY,
  COMMISSION_REPOSITORY,
  ITBA_API_SERVICE,
} from "@/shared/constants/injection-tokens";

@Module({
  controllers: [
    CareerController,
    ClassroomController,
    SubjectController,
    SubjectPlanController,
    DataSyncController,
    WikiBookmarkController
  ],
  providers: [
    PrismaService,
    CareerService,
    ClassroomService,
    SubjectService,
    SubjectPlanService,
    CommissionServiceImpl,
    DataSyncService,
    CronService,
    WikiBookmarkService,

    {
      provide: CAREER_REPOSITORY,
      useFactory: (prismaService: PrismaService) => {
        return new CareerRepositoryImpl(prismaService);
      },
      inject: [PrismaService],
    },
    {
      provide: CLASSROOM_REPOSITORY,
      useFactory: (prismaService: PrismaService) => {
        return new ClassroomRepositoryImpl(prismaService);
      },
      inject: [PrismaService],
    },
    {
      provide: SUBJECT_REPOSITORY,
      useFactory: (prismaService: PrismaService) => {
        return new SubjectRepositoryImpl(prismaService);
      },
      inject: [PrismaService],
    },
    {
      provide: SUBJECT_PLAN_REPOSITORY,
      useFactory: (prismaService: PrismaService) => {
        return new SubjectPlanRepositoryImpl(prismaService);
      },
      inject: [PrismaService],
    },
    {
      provide: COMMISSION_REPOSITORY,
      useFactory: (prismaService: PrismaService) => {
        return new CommissionRepositoryImpl(prismaService);
      },
      inject: [PrismaService],
    },
    {
      provide: ITBA_API_SERVICE,
      useFactory: () => {
        const ITBA_API_TOKEN = process.env.ITBA_API_TOKEN!;
        const ITBA_API_BASE_URL = process.env.ITBA_API_BASE_URL!;
        const ITBA_API_TIMEOUT = process.env.ITBA_API_TIMEOUT || "30000";

        const itbaApiClient = ApiFactory.createClient("itba-api", {
          baseUrl: ITBA_API_BASE_URL,
          timeout: parseInt(ITBA_API_TIMEOUT),
          defaultHeaders: {
            "Content-Type": "application/json",
          },
        });

        return new ItbaApiServiceImpl(ITBA_API_TOKEN, undefined, itbaApiClient);
      },
    },
  ],
  exports: [
    CareerService,
    ClassroomService,
    SubjectService,
    SubjectPlanService,
    CommissionServiceImpl,
    DataSyncService,
    CronService,
    WikiBookmarkService
  ],
})
export class ItbaModule { }
