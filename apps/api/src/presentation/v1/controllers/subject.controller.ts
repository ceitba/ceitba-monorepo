import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SubjectService } from '@/domain/itba/services/subject.service';
import { SubjectPlanService } from '@/domain/itba/services/subject-plan.service';
import { ItbaMappers } from '@/shared/mappers/itba.mappers';
import { SubjectResponseDto } from '../dto/subject.dto';
import { SectionSubjectsDto } from '../dto/subject-plan-response.dto';

@ApiTags('Subjects')
@Controller('v1/itba/subjects')
export class SubjectController {
    constructor(
        private readonly subjectService: SubjectService,
        private readonly subjectPlanService: SubjectPlanService
    ) { }

    @Get()
    @ApiOperation({ summary: 'Get subjects organized by plan' })
    @ApiQuery({ name: 'plan', description: 'Plan identifier (e.g. S10-Rev23)', required: true })
    @ApiResponse({ status: 200, description: 'Subjects organized by section, year, and semester', type: SectionSubjectsDto })
    @ApiResponse({ status: 404, description: 'Plan not found' })
    async getSubjectsByPlan(@Query('plan') plan: string): Promise<SectionSubjectsDto> {
        if (!plan) {
            throw new NotFoundException('Plan parameter is required');
        }

        const organizedSubjects = await this.subjectPlanService.getSubjectsByPlanOrganized(plan);
        
        if (Object.keys(organizedSubjects).length === 0) {
            throw new NotFoundException('No subjects found for the specified plan');
        }

        return organizedSubjects;
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get a subject by ID' })
    @ApiParam({ name: 'id', description: 'Subject identifier (e.g. plan code)' })
    @ApiResponse({ status: 200, description: 'Subject found', type: SubjectResponseDto })
    @ApiResponse({ status: 404, description: 'Subject not found' })
    async getSubjectById(@Param('id') id: string) {
        const subject = await this.subjectService.getSubjectById(id);

        if (!subject) {
            throw new NotFoundException('Subject not found');
        }

        return ItbaMappers.subjectToDto(subject);
    }
}
