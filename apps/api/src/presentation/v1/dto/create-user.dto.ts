import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, IsNumber, IsOptional } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    description: 'User file number',
    example: 12345,
  })
  @IsOptional()
  @IsNumber()
  file_number?: number;

  @ApiPropertyOptional({
    description: 'User name',
    example: 'John Doe',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Career ID',
    example: 'career-123',
  })
  @IsOptional()
  @IsString()
  career_id?: string;

  @ApiPropertyOptional({
    description: 'Study plan',
    example: 'Plan 2020',
  })
  @IsOptional()
  @IsString()
  plan?: string;
}
