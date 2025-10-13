import { Controller, Get, Post, Put, Delete, Query, Param, Body, HttpCode, HttpStatus, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { SubjectPlanService } from '@/domain/itba/services/subject-plan.service';
import { SubjectPlanQueryDto, CreateSubjectPlanDto, UpdateSubjectPlanDto } from '../dto/subject-plan.dto';

@ApiTags('Subject by plan')
@Controller('v1/plans')
export class SubjectPlanController {
    constructor(private readonly subjectPlanService: SubjectPlanService) { }

    @Get(':planId/subjects')
    @ApiOperation({ summary: 'Get subjects by plan with filters' })
    @ApiParam({ name: 'planId', description: 'Plan ID' })
    @ApiResponse({ status: 200, description: 'List of subjects for the plan' })
    async getSubjectsByPlan(
        @Param('planId') planId: string,
        @Query() query: SubjectPlanQueryDto
    ) {
        return await this.subjectPlanService.getSubjectsByPlanWithFilters(planId, {
            year: query.year || undefined,
            semester: query.semester || undefined,
            section: query.section,
            type: query.type
        });
    }


    @Get('subjects/:subjectId/plans')
    @ApiOperation({ summary: 'Get subject plans by subject' })
    @ApiParam({ name: 'subjectId', description: 'Subject ID' })
    @ApiResponse({ status: 200, description: 'List of subject plans' })
    async getSubjectPlansBySubject(@Param('subjectId') subjectId: string) {
        return await this.subjectPlanService.getSubjectPlansBySubject(subjectId);
    }

    @Get(':planId/subject/:subjectId')
    @ApiOperation({ summary: 'Get specific subject plan' })
    @ApiParam({ name: 'planId', description: 'Plan ID' })
    @ApiParam({ name: 'subjectId', description: 'Subject ID' })
    @ApiResponse({ status: 200, description: 'Subject plan found' })
    @ApiResponse({ status: 404, description: 'Subject plan not found' })
    async getSubjectPlan(
        @Param('planId') planId: string,
        @Param('subjectId') subjectId: string
    ) {
        const subjectPlan = await this.subjectPlanService.getSubjectPlan(planId, subjectId);

        if (!subjectPlan) {
            throw new NotFoundException('Subject plan not found');
        }

        return subjectPlan;
    }

    @Post(':planId/subject')
    @HttpCode(HttpStatus.CREATED)
    @ApiOperation({ summary: 'Create a new subject plan' })
    @ApiParam({ name: 'planId', description: 'Plan ID' })
    @ApiBody({ type: CreateSubjectPlanDto })
    @ApiResponse({ status: 201, description: 'Subject plan created successfully' })
    async createSubjectPlan(
        @Param('planId') planId: string,
        @Body() createData: CreateSubjectPlanDto
    ) {
        const createSubjectPlanDto = {
            ...createData,
            planId,
            year: createData.year ?? null,
            semester: createData.semester ?? null,
            creditsRequired: createData.creditsRequired ?? null,
            dependencies: createData.dependencies ?? []
        };

        return await this.subjectPlanService.createSubjectPlan(createSubjectPlanDto);
    }

    @Put(':planId/subject/:subjectId')
    @ApiOperation({ summary: 'Update subject plan' })
    @ApiParam({ name: 'planId', description: 'Plan ID' })
    @ApiParam({ name: 'subjectId', description: 'Subject ID' })
    @ApiBody({ type: UpdateSubjectPlanDto })
    @ApiResponse({ status: 200, description: 'Subject plan updated successfully' })
    @ApiResponse({ status: 404, description: 'Subject plan not found' })
    async updateSubjectPlan(
        @Param('planId') planId: string,
        @Param('subjectId') subjectId: string,
        @Body() updateData: UpdateSubjectPlanDto
    ) {
        const updatedSubjectPlan = await this.subjectPlanService.updateSubjectPlan(planId, subjectId, updateData);

        if (!updatedSubjectPlan) {
            throw new NotFoundException('Subject plan not found');
        }

        return updatedSubjectPlan;
    }

    @Delete(':planId/subject/:subjectId')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete subject plan' })
    @ApiParam({ name: 'planId', description: 'Plan ID' })
    @ApiParam({ name: 'subjectId', description: 'Subject ID' })
    @ApiResponse({ status: 204, description: 'Subject plan deleted successfully' })
    @ApiResponse({ status: 404, description: 'Subject plan not found' })
    async deleteSubjectPlan(
        @Param('planId') planId: string,
        @Param('subjectId') subjectId: string
    ) {
        const deleted = await this.subjectPlanService.deleteSubjectPlan(planId, subjectId);

        if (!deleted) {
            throw new NotFoundException('Subject plan not found');
        }
    }
}