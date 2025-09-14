import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { UserService } from "@/domain/user/services/user.service";
import { CreateUserDto } from "../dto/create-user.dto";

@ApiTags('Users')
@Controller('v1/users')
export class UserController {
    constructor(private readonly userService: UserService) {}

    @Post('create')
    @HttpCode(HttpStatus.CREATED)
    @ApiOperation({ summary: 'Create a new user' })
    @ApiBody({ type: CreateUserDto })
    @ApiResponse({ 
        status: 201, 
        description: 'User created successfully',
        schema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                email: { type: 'string' },
                name: { type: 'string' },
                file_number: { type: 'number' },
                career_id: { type: 'string' },
                plan: { type: 'string' },
            }
        }
    })
    @ApiResponse({ status: 400, description: 'Invalid request data' })
    async createUser(@Body() createUserDto: CreateUserDto) {
        return await this.userService.createUser(createUserDto);
    }

    @Get()
    @ApiOperation({ summary: 'Get all users' })
    @ApiResponse({ 
        status: 200, 
        description: 'List of all users',
        schema: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    email: { type: 'string' },
                    name: { type: 'string' },
                    file_number: { type: 'number' },
                    career_id: { type: 'string' },
                    plan: { type: 'string' },
                }
            }
        }
    })
    async getAllUsers() {
        return await this.userService.getAllUsers();
    }
}