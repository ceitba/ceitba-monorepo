export { Career } from '@/domain/itba/models/career.model';
export { Subject } from '@/domain/itba/models/subject.model';
export { SubjectPlan } from '@/domain/itba/models/subject-plan.model';
export { Classroom, ClassroomSchedule, TimeSlot, DayOfWeek } from '@/domain/itba/models/classroom.model';

export type { CareerDto, CreateCareerDto } from '@/domain/itba/dto/career.dto';
export type { SubjectDto, CreateSubjectDto } from '@/domain/itba/dto/subject.dto';
export type { 
    SubjectPlanDto, 
    CreateSubjectPlanDto,
    DatabaseSubjectPlan,
    SubjectPlan as LegacySubjectPlan
} from '@/domain/itba/dto/subjectPlan.dto';
export type { 
    ClassroomDto, 
    ClassroomScheduleDto, 
    ClassroomsByBuildingDto, 
    ClassroomsByDayAndBuildingDto 
} from '@/domain/itba/dto/classroom.dto';

export type { CareerRepository } from '@/domain/itba/interfaces/repositories/career.repository.interface';
export type { SubjectRepository } from '@/domain/itba/interfaces/repositories/subject.repository.interface';
export type { SubjectPlanRepository } from '@/domain/itba/interfaces/repositories/subject-plan.repository.interface';
export type { ClassroomRepository } from '@/domain/itba/interfaces/repositories/classroom.repository.interface';
export type { ItbaApiService } from '@/domain/itba/interfaces/repositories/itba-api.service.interface';

export { CareerService } from '@/domain/itba/services/career.service';
export { SubjectService } from '@/domain/itba/services/subject.service';
export { SubjectPlanService } from '@/domain/itba/services/subject-plan.service';
export { ClassroomService } from '@/domain/itba/services/classroom.service';

export { CareerRepositoryImpl } from '@/domain/itba/repositories/career.repository.impl';
export { SubjectRepositoryImpl } from '@/domain/itba/repositories/subject.repository.impl';
export { SubjectPlanRepositoryImpl } from '@/domain/itba/repositories/subject-plan.repository.impl';
export { ClassroomRepositoryImpl } from '@/domain/itba/repositories/classroom.repository.impl';
export { ItbaApiServiceImpl } from '@/domain/itba/repositories/itba-api.service.impl';
