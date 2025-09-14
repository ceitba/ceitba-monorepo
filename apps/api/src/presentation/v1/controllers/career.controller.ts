import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { CareerService } from '@/domain/itba/services/career.service';
import { CreateCareerDto, UpdateCareerDto } from '../dto/career.dto';

@ApiTags('Careers')
@Controller('v1/itba/careers')
export class CareerController {
    constructor(private readonly careerService: CareerService) {}

    @Get('plans')
    @ApiOperation({ summary: 'Get careers with their plans' })
    @ApiResponse({ status: 200, description: 'List of careers with plans' })
    async getCareerPlans() {
        return await this.careerService.getCareersWithPlans();
    }

    @Get()
    @ApiOperation({ summary: 'Get all careers' })
    @ApiResponse({ status: 200, description: 'List of all careers' })
    async getAllCareers() {
        return await this.careerService.getAllCareers();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get career by ID' })
    @ApiParam({ name: 'id', description: 'Career ID' })
    @ApiResponse({ status: 200, description: 'Career found' })
    @ApiResponse({ status: 404, description: 'Career not found' })
    async getCareerById(@Param('id') id: string) {
        const career = await this.careerService.getCareerById(id);
        
        if (!career) {
            throw new NotFoundException('Career not found');
        }

        return career;
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    @ApiOperation({ summary: 'Create a new career' })
    @ApiBody({ type: CreateCareerDto })
    @ApiResponse({ status: 201, description: 'Career created successfully' })
    @ApiResponse({ status: 400, description: 'Invalid request data' })
    async createCareer(@Body() createCareerDto: CreateCareerDto) {
        return await this.careerService.createCareer(createCareerDto);
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update career by ID' })
    @ApiParam({ name: 'id', description: 'Career ID' })
    @ApiBody({ type: UpdateCareerDto })
    @ApiResponse({ status: 200, description: 'Career updated successfully' })
    @ApiResponse({ status: 404, description: 'Career not found' })
    async updateCareer(@Param('id') id: string, @Body() updateCareerDto: UpdateCareerDto) {
        const career = await this.careerService.updateCareer(id, updateCareerDto);
        
        if (!career) {
            throw new NotFoundException('Career not found');
        }

        return career;
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete career by ID' })
    @ApiParam({ name: 'id', description: 'Career ID' })
    @ApiResponse({ status: 204, description: 'Career deleted successfully' })
    @ApiResponse({ status: 404, description: 'Career not found' })
    async deleteCareer(@Param('id') id: string) {
        const deleted = await this.careerService.deleteCareer(id);
        
        if (!deleted) {
            throw new NotFoundException('Career not found');
        }
    }
}
