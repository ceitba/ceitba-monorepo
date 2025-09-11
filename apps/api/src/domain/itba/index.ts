export { Career } from './models/career.model';
export { Subject } from './models/subject.model';
export { SubjectPlan } from './models/subject-plan.model';
export { Classroom, ClassroomSchedule, TimeSlot, DayOfWeek } from './models/classroom.model';

export type { CareerDto, CreateCareerDto } from './dto/career.dto';
export type { SubjectDto, CreateSubjectDto } from './dto/subject.dto';
export type { 
    SubjectPlanDto, 
    CreateSubjectPlanDto,
    DatabaseSubjectPlan,
    SubjectPlan as LegacySubjectPlan
} from './dto/subjectPlan.dto';
export type { 
    ClassroomDto, 
    ClassroomScheduleDto, 
    ClassroomsByBuildingDto, 
    ClassroomsByDayAndBuildingDto 
} from './dto/classroom.dto';

export type { CareerRepository } from './interfaces/career.repository.interface';
export type { SubjectRepository } from './interfaces/subject.repository.interface';
export type { SubjectPlanRepository } from './interfaces/subject-plan.repository.interface';
export type { ClassroomRepository } from './interfaces/classroom.repository.interface';
export type { ItbaApiService } from './interfaces/itba-api.service.interface';

export { CareerService } from './services/career.service';
export { SubjectService } from './services/subject.service';
export { SubjectPlanService } from './services/subject-plan.service';
export { ClassroomService } from './services/classroom.service';

export { CareerRepositoryImpl } from './repositories/career.repository.impl';
export { SubjectRepositoryImpl } from './repositories/subject.repository.impl';
export { SubjectPlanRepositoryImpl } from './repositories/subject-plan.repository.impl';
export { ClassroomRepositoryImpl } from './repositories/classroom.repository.impl';
export { ItbaApiServiceImpl } from './repositories/itba-api.service.impl';
