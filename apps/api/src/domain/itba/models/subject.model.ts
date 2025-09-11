export class Subject {
    constructor(
        public readonly id: string,
        public readonly name: string,
        public readonly credits: number
    ) {
        if (credits < 0) {
            throw new Error('Credits must be non-negative');
        }
        if (!name.trim()) {
            throw new Error('Subject name cannot be empty');
        }
    }

    public equals(other: Subject): boolean {
        return this.id === other.id;
    }
}
