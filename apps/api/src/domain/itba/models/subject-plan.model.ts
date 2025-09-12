import { Subject } from '@/domain/itba/models/subject.model';

export class SubjectPlan {
    constructor(
        public readonly subjectId: string,
        public readonly planId: string,
        public readonly section: string,
        public readonly year: number | null,
        public readonly semester: number | null,
        public readonly dependencies: string[],
        public readonly creditsRequired: number | null,
        public readonly subject: Subject
    ) {
        if (!section.trim()) {
            throw new Error('Section cannot be empty');
        }
        if (year !== null && year < 1) {
            throw new Error('Year must be positive');
        }
        if (semester !== null && (semester < 1 || semester > 2)) {
            throw new Error('Semester must be 1 or 2');
        }
        if (creditsRequired !== null && creditsRequired < 0) {
            throw new Error('Credits required must be non-negative');
        }
    }

    public hasDependencies(): boolean {
        return this.dependencies.length > 0;
    }

    public isDependentOn(subjectId: string): boolean {
        return this.dependencies.includes(subjectId);
    }

    public isElective(): boolean {
        return this.year === null && this.semester === null;
    }

    public getAcademicPeriod(): string {
        if (this.isElective()) {
            return 'Elective';
        }
        return `Year ${this.year}, Semester ${this.semester}`;
    }
}
