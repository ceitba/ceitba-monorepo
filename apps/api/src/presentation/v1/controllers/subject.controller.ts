import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SubjectService } from '@/domain/itba/services/subject.service';
import { ItbaMappers } from '@/shared/mappers/itba.mappers';
import { SubjectResponseDto } from '../dto/subject.dto';

@ApiTags('Subjects')
@Controller('v1/itba/subjects')
export class SubjectController {
    constructor(private readonly subjectService: SubjectService) { }

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
