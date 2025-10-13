import { Controller, Get, Post, Query, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { ClassroomService } from '@/domain/itba/services/classroom.service';
import { ItbaMappers } from '@/shared/mappers/itba.mappers';
import { ClassroomQueryDto, ClassroomConflictDto } from '../dto/classroom.dto';

@ApiTags('Classrooms')
@Controller('v1/classrooms')
export class ClassroomController {
    constructor(private readonly classroomService: ClassroomService) {}

    @Get()
    @ApiOperation({ summary: 'Get classrooms with filters' })
    @ApiResponse({ status: 200, description: 'List of classrooms' })
    async getClassrooms(@Query() query: ClassroomQueryDto) {
        const classrooms = await this.classroomService.getClassroomsWithFilters({
            status: query.status,
            current_semester: query.current_semester
        });

        if (query.status === 'occupied') {
            return ItbaMappers.groupClassroomsByDayAndBuilding(classrooms);
        } else {
            return ItbaMappers.groupClassroomsByBuilding(classrooms);
        }
    }

    @Get('building/:building')
    @ApiOperation({ summary: 'Get classrooms by building' })
    @ApiParam({ name: 'building', description: 'Building name' })
    @ApiResponse({ status: 200, description: 'List of classrooms in building' })
    async getClassroomsByBuilding(@Param('building') building: string) {
        const classrooms = await this.classroomService.getClassroomsByBuilding(building);
        return ItbaMappers.classroomSchedulesToDto(classrooms);
    }

    @Get('day/:day')
    @ApiOperation({ summary: 'Get classrooms by day' })
    @ApiParam({ name: 'day', description: 'Day of the week' })
    @ApiResponse({ status: 200, description: 'List of classrooms for the day' })
    async getClassroomsByDay(@Param('day') day: string) {
        const classrooms = await this.classroomService.getClassroomsByDay(day);
        return ItbaMappers.classroomSchedulesToScheduleDto(classrooms);
    }

    @Post('conflicts')
    @ApiOperation({ summary: 'Check for classroom conflicts' })
    @ApiBody({ type: ClassroomConflictDto })
    @ApiResponse({ status: 200, description: 'List of conflicts found' })
    async checkConflicts(@Body() conflictRequest: ClassroomConflictDto) {
        const conflicts = await this.classroomService.checkForConflicts(
            conflictRequest.classroom,
            conflictRequest.building,
            conflictRequest.day,
            conflictRequest.hourFrom,
            conflictRequest.hourTo
        );
        
        return ItbaMappers.classroomSchedulesToScheduleDto(conflicts);
    }
}