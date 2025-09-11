import { Subject } from '../models/subject.model';
import { SubjectRepository } from '../interfaces/subject.repository.interface';
import { SubjectDto, CreateSubjectDto } from '../dto/subject.dto';

export class SubjectService {
    constructor(private readonly subjectRepository: SubjectRepository) {}

    async getAllSubjects(): Promise<SubjectDto[]> {
        const subjects = await this.subjectRepository.findAll();
        return subjects.map(this.mapToDto);
    }

    async getSubjectById(id: string): Promise<SubjectDto | null> {
        const subject = await this.subjectRepository.findById(id);
        return subject ? this.mapToDto(subject) : null;
    }

    async getSubjectsByName(name: string): Promise<SubjectDto[]> {
        const subjects = await this.subjectRepository.findByName(name);
        return subjects.map(this.mapToDto);
    }

    async createSubject(createSubjectDto: CreateSubjectDto): Promise<SubjectDto> {
        const subject = new Subject(
            createSubjectDto.id,
            createSubjectDto.name,
            createSubjectDto.credits
        );
        const savedSubject = await this.subjectRepository.create(subject);
        return this.mapToDto(savedSubject);
    }

    async updateSubject(id: string, updateData: Partial<CreateSubjectDto>): Promise<SubjectDto | null> {
        const existingSubject = await this.subjectRepository.findById(id);
        if (!existingSubject) {
            return null;
        }

        const updatedSubject = new Subject(
            id,
            updateData.name ?? existingSubject.name,
            updateData.credits ?? existingSubject.credits
        );

        const savedSubject = await this.subjectRepository.update(updatedSubject);
        return this.mapToDto(savedSubject);
    }

    async deleteSubject(id: string): Promise<boolean> {
        const existingSubject = await this.subjectRepository.findById(id);
        if (!existingSubject) {
            return false;
        }

        await this.subjectRepository.delete(id);
        return true;
    }

    async getSubjectsByIds(ids: string[]): Promise<SubjectDto[]> {
        const subjects = await this.subjectRepository.findByIds(ids);
        return subjects.map(this.mapToDto);
    }

    private mapToDto(subject: Subject): SubjectDto {
        return {
            id: subject.id,
            name: subject.name,
            credits: subject.credits
        };
    }
}
