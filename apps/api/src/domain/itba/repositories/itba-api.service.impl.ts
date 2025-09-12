import { SubjectPlan } from '@/domain/itba/models/subject-plan.model';
import { Subject } from '@/domain/itba/models/subject.model';
import { 
    ItbaApiService, 
    ITBACareerPlans,
    ITBASection,
    ITBASubject 
} from '@/domain/itba/interfaces/repositories/itba-api.service.interface';
import { ApiClient, ApiFactory } from '@/shared/external-apis';

export class ItbaApiServiceImpl implements ItbaApiService {
    private readonly apiClient: ApiClient;
    private readonly apiToken: string;

    constructor(apiToken: string, apiClient?: ApiClient) {
        this.apiToken = apiToken;
        this.apiClient = apiClient || ApiFactory.createItbaApiClient(apiToken);
    }

    async getSubjectsByPlan(planId: string): Promise<SubjectPlan[]> {
        const subjectPlans: SubjectPlan[] = [];

        try {
            const response = await this.apiClient.get<ITBACareerPlans>(
                `/careerPlans/${this.apiToken}`,
                {
                    params: { plan: planId }
                }
            );

            if (response.error) {
                throw new Error(`API Error: ${response.error.message}`);
            }

            if (!response.data) {
                throw new Error('No data received from ITBA API');
            }

            const jsonData = response.data;

            jsonData.careerplan.section = Array.isArray(jsonData.careerplan.section) 
                ? jsonData.careerplan.section 
                : [jsonData.careerplan.section];

            jsonData.careerplan.section.forEach(jsonSection => {
                this.processSection(jsonSection, planId, subjectPlans);
            });

            return subjectPlans;
        } catch (error) {
            throw new Error(
                `Error fetching data from ITBA API for planId: ${planId} - ${(error as Error).message}`
            );
        }
    }

    async getAllSubjects(): Promise<any[]> {
        return [];
    }

    private processSection(jsonSection: ITBASection, planId: string, subjectPlans: SubjectPlan[]): void {
        if (jsonSection.terms) {
            const terms = Array.isArray(jsonSection.terms.term) 
                ? jsonSection.terms.term 
                : [jsonSection.terms.term];

            terms.forEach(jsonPeriod => {
                if (jsonPeriod.entries) {
                    const entries = Array.isArray(jsonPeriod.entries.entry) 
                        ? jsonPeriod.entries.entry 
                        : [jsonPeriod.entries.entry];

                    entries.forEach(jsonSubject => {
                        if (jsonSubject.type === "subject") {
                            const subjectPlan = this.createSubjectPlan(
                                jsonSubject,
                                planId,
                                jsonSection.name,
                                parseInt(jsonPeriod.year),
                                parseInt(jsonPeriod.period)
                            );
                            subjectPlans.push(subjectPlan);
                        }
                    });
                }
            });
        } else if (jsonSection.withoutTerm) {
            const withoutTermSubjects = Array.isArray(jsonSection.withoutTerm.withoutTerm) 
                ? jsonSection.withoutTerm.withoutTerm 
                : [jsonSection.withoutTerm.withoutTerm];

            withoutTermSubjects.forEach(jsonSubject => {
                if (jsonSubject.type === "subject") {
                    const subjectPlan = this.createSubjectPlan(
                        jsonSubject,
                        planId,
                        jsonSection.name,
                        null,
                        null
                    );
                    subjectPlans.push(subjectPlan);
                }
            });
        }
    }

    private createSubjectPlan(
        jsonSubject: ITBASubject,
        planId: string,
        section: string,
        year: number | null,
        semester: number | null
    ): SubjectPlan {
        const dependencies = this.extractDependencies(jsonSubject);
        const creditsRequired = jsonSubject.creditsRequired 
            ? parseInt(jsonSubject.creditsRequired) 
            : null;

        const subject = new Subject(
            jsonSubject.code!,
            jsonSubject.name,
            parseInt(jsonSubject.credits)
        );

        return new SubjectPlan(
            jsonSubject.code!,
            planId,
            section,
            year,
            semester,
            dependencies,
            creditsRequired,
            subject
        );
    }

    private extractDependencies(jsonSubject: ITBASubject): string[] {
        if (!jsonSubject.dependencies?.dependency) {
            return [];
        }

        if (Array.isArray(jsonSubject.dependencies.dependency)) {
            return jsonSubject.dependencies.dependency;
        } else {
            return [jsonSubject.dependencies.dependency];
        }
    }
}
