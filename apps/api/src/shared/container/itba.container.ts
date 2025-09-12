import { DatabaseFactory } from '@/shared/database/database.factory';

import { CareerService } from '@/domain/itba/services/career.service';
import { ClassroomService } from '@/domain/itba/services/classroom.service';
import { SubjectPlanService } from '@/domain/itba/services/subject-plan.service';
import { SubjectService } from '@/domain/itba/services/subject.service';

import { CareerRepositoryImpl } from '@/domain/itba/repositories/career.repository.impl';
import { ClassroomRepositoryImpl } from '@/domain/itba/repositories/classroom.repository.impl';
import { SubjectPlanRepositoryImpl } from '@/domain/itba/repositories/subject-plan.repository.impl';
import { SubjectRepositoryImpl } from '@/domain/itba/repositories/subject.repository.impl';
import { ItbaApiServiceImpl } from '@/domain/itba/repositories/itba-api.service.impl';

import { CareerController } from '@/presentation/v1/controllers/career.controller';
import { ClassroomController } from '@/presentation/v1/controllers/classroom.controller';
import { SubjectPlanController } from '@/presentation/v1/controllers/subject-plan.controller';
import { CareerRepository, ClassroomRepository, ItbaApiService, SubjectPlanRepository, SubjectRepository } from '@/domain/itba';
import { ContainerInterface } from "@/shared/container/container.interface";

/**
 * 
 * Container for ITBA dependencies
 * 
 * @class ItbaContainer
 * @description Container for ITBA dependencies
 * 
 */
export class ItbaContainer implements ContainerInterface {
    private static instance: ItbaContainer | null = null;
    
    private _careerRepository: CareerRepository | null = null;
    private _classroomRepository: ClassroomRepository | null = null;
    private _subjectRepository: SubjectRepository | null = null;
    private _subjectPlanRepository: SubjectPlanRepository | null = null;
    private _itbaApiService: ItbaApiService | null = null;
    
    private _careerService: CareerService | null = null;
    private _classroomService: ClassroomService | null = null;
    private _subjectService: SubjectService | null = null;
    private _subjectPlanService: SubjectPlanService | null = null;
    
    private _careerController: CareerController | null = null;
    private _classroomController: ClassroomController | null = null;
    private _subjectPlanController: SubjectPlanController | null = null;

    private constructor() {}

    static getInstance(): ItbaContainer {
        if (!this.instance) {
            this.instance = new ItbaContainer();
        }
        return this.instance;
    }

    get careerRepository(): CareerRepository {
        if (!this._careerRepository) {
            const db = DatabaseFactory.getInstance();
            this._careerRepository = new CareerRepositoryImpl(db);
        }
        return this._careerRepository;
    }

    get classroomRepository(): ClassroomRepository {
        if (!this._classroomRepository) {
            const db = DatabaseFactory.getInstance();
            this._classroomRepository = new ClassroomRepositoryImpl(db);
        }
        return this._classroomRepository;
    }

    get subjectRepository(): SubjectRepository {
        if (!this._subjectRepository) {
            const db = DatabaseFactory.getInstance();
            this._subjectRepository = new SubjectRepositoryImpl(db);
        }
        return this._subjectRepository;
    }

    get subjectPlanRepository(): SubjectPlanRepository {
        if (!this._subjectPlanRepository) {
            this._subjectPlanRepository = new SubjectPlanRepositoryImpl();
        }
        return this._subjectPlanRepository;
    }

    get itbaApiService(): ItbaApiService {
        if (!this._itbaApiService) {
            throw new Error('ItbaApiService not configured. Call setItbaApiService() first.');
        }
        return this._itbaApiService;
    }

    setItbaApiService(service: ItbaApiService): void {
        this._itbaApiService = service;
    }

    get careerService(): CareerService {
        if (!this._careerService) {
            this._careerService = new CareerService(this.careerRepository);
        }
        return this._careerService;
    }

    get classroomService(): ClassroomService {
        if (!this._classroomService) {
            this._classroomService = new ClassroomService(this.classroomRepository);
        }
        return this._classroomService;
    }

    get subjectService(): SubjectService {
        if (!this._subjectService) {
            this._subjectService = new SubjectService(this.subjectRepository);
        }
        return this._subjectService;
    }

    get subjectPlanService(): SubjectPlanService {
        if (!this._subjectPlanService) {
            this._subjectPlanService = new SubjectPlanService(
                this.subjectPlanRepository,
                this.subjectRepository,
                this.itbaApiService
            );
        }
        return this._subjectPlanService;
    }

    get careerController(): CareerController {
        if (!this._careerController) {
            this._careerController = new CareerController(this.careerService);
        }
        return this._careerController;
    }

    get classroomController(): ClassroomController {
        if (!this._classroomController) {
            this._classroomController = new ClassroomController(this.classroomService);
        }
        return this._classroomController;
    }

    get subjectPlanController(): SubjectPlanController {
        if (!this._subjectPlanController) {
            this._subjectPlanController = new SubjectPlanController(this.subjectPlanService);
        }
        return this._subjectPlanController;
    }

    reset(): void {
        // TODO: Add reset logic
        ItbaContainer.instance = null;
        DatabaseFactory.reset();
    }

    getInstance(): ItbaContainer {
        return this;
    }

}
