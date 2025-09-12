import { Subject } from '@/domain/itba/models/subject.model';
import { CreateSubjectDto } from '@/domain/itba/dto/subject.dto';

export interface SubjectServiceInterface {
    getAllSubjects(): Promise<Subject[]>;
    getSubjectById(id: string): Promise<Subject | null>;
    getSubjectsByName(name: string): Promise<Subject[]>;
    createSubject(createSubjectDto: CreateSubjectDto): Promise<Subject>;
    updateSubject(id: string, updateData: Partial<CreateSubjectDto>): Promise<Subject | null>;
    deleteSubject(id: string): Promise<boolean>;
    getSubjectsByIds(ids: string[]): Promise<Subject[]>;
}
