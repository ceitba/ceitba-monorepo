export enum DayOfWeek {
    MONDAY = 'Monday',
    TUESDAY = 'Tuesday',
    WEDNESDAY = 'Wednesday',
    THURSDAY = 'Thursday',
    FRIDAY = 'Friday',
    SATURDAY = 'Saturday',
    SUNDAY = 'Sunday'
}

export class TimeSlot {
    constructor(
        public readonly hourFrom: string,
        public readonly hourTo: string
    ) {
        this.validateTimeFormat(hourFrom);
        this.validateTimeFormat(hourTo);
        
        if (this.compareTime(hourFrom, hourTo) >= 0) {
            throw new Error('Start time must be before end time');
        }
    }

    private validateTimeFormat(time: string): void {
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(time)) {
            throw new Error(`Invalid time format: ${time}. Expected HH:MM`);
        }
    }

    private compareTime(time1: string, time2: string): number {
        const [h1, m1] = time1.split(':').map(Number);
        const [h2, m2] = time2.split(':').map(Number);
        
        const minutes1 = h1 * 60 + m1;
        const minutes2 = h2 * 60 + m2;
        
        return minutes1 - minutes2;
    }

    public overlaps(other: TimeSlot): boolean {
        return this.compareTime(this.hourFrom, other.hourTo) < 0 && 
               this.compareTime(other.hourFrom, this.hourTo) < 0;
    }
}

export class Classroom {
    constructor(
        public readonly name: string,
        public readonly building: string
    ) {
        if (!name.trim()) {
            throw new Error('Classroom name cannot be empty');
        }
        if (!building.trim()) {
            throw new Error('Building name cannot be empty');
        }
    }

    public isOnline(): boolean {
        return this.building.toLowerCase() === 'online';
    }

    public getFullName(): string {
        return `${this.building} - ${this.name}`;
    }
}

export class ClassroomSchedule {
    constructor(
        public readonly classroom: Classroom,
        public readonly day: DayOfWeek | null,
        public readonly timeSlot: TimeSlot | null
    ) {}

    public isAvailable(): boolean {
        return this.day === null && this.timeSlot === null;
    }

    public isOccupied(): boolean {
        return !this.isAvailable();
    }

    public conflictsWith(other: ClassroomSchedule): boolean {
        if (this.classroom.name !== other.classroom.name || 
            this.classroom.building !== other.classroom.building) {
            return false;
        }

        if (this.day !== other.day) {
            return false;
        }

        if (!this.timeSlot || !other.timeSlot) {
            return false;
        }

        return this.timeSlot.overlaps(other.timeSlot);
    }
}
