export class Career {
    constructor(
        public readonly id: string,
        public readonly name: string,
        public readonly plans: string[]
    ) {}

    public addPlan(planId: string): Career {
        if (this.plans.includes(planId)) {
            return this;
        }
        
        return new Career(
            this.id,
            this.name,
            [...this.plans, planId]
        );
    }

    public removePlan(planId: string): Career {
        return new Career(
            this.id,
            this.name,
            this.plans.filter(p => p !== planId)
        );
    }

    public hasPlan(planId: string): boolean {
        return this.plans.includes(planId);
    }
}
