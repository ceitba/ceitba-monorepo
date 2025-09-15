export enum SubjectType {
    ANNUAL = 'ANNUAL',
    SEMESTRAL = 'SEMESTRAL',
    SAMINARY = 'SAMINARY'
}

export enum DayOfWeek {
    MONDAY = 'MONDAY',
    TUESDAY = 'TUESDAY',
    WEDNESDAY = 'WEDNESDAY',
    THURSDAY = 'THURSDAY',
    FRIDAY = 'FRIDAY',
    SATURDAY = 'SATURDAY',
    SUNDAY = 'SUNDAY'
}

export class CommissionTime {
    constructor(
        public readonly courseId: string,
        public readonly day: DayOfWeek,
        public readonly classroom: string,
        public readonly building: string,
        public readonly hourFrom: Date,
        public readonly hourTo: Date
    ) {}
}

export class Commission {
    constructor(
        public readonly id: string,
        public readonly subjectCode: string,
        public readonly commissionName: string,
        public readonly courseStart: Date,
        public readonly courseEnd: Date,
        public readonly enrolledStudents: number,
        public readonly quota: number,
        public readonly subjectType: SubjectType,
        public readonly times: CommissionTime[] = []
    ) {}

    public addTime(time: CommissionTime): Commission {
        return new Commission(
            this.id,
            this.subjectCode,
            this.commissionName,
            this.courseStart,
            this.courseEnd,
            this.enrolledStudents,
            this.quota,
            this.subjectType,
            [...this.times, time]
        );
    }

    public updateEnrollment(enrolledStudents: number): Commission {
        return new Commission(
            this.id,
            this.subjectCode,
            this.commissionName,
            this.courseStart,
            this.courseEnd,
            enrolledStudents,
            this.quota,
            this.subjectType,
            this.times
        );
    }

    public isActive(): boolean {
        const now = new Date();
        return now >= this.courseStart && now <= this.courseEnd;
    }

    public hasCapacity(): boolean {
        return this.enrolledStudents < this.quota;
    }
}
