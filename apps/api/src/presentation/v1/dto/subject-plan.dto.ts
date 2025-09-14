import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, Min, Max, IsInt, IsEnum } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class SubjectPlanQueryDto {
  @ApiPropertyOptional({
    description: 'Year',
    example: 2024,
  })
  @IsOptional()
  @Transform(({ value }) => value ? parseInt(value, 10) : null)
  @IsNumber()
  year?: number;

  @ApiPropertyOptional({
    description: 'Semester',
    example: 1,
  })
  @IsOptional()
  @Transform(({ value }) => value ? parseInt(value, 10) : null)
  @IsNumber()
  semester?: number;

  @ApiPropertyOptional({
    description: 'Section',
    example: 'A',
  })
  @IsOptional()
  @IsString()
  section?: string;

  @ApiPropertyOptional({
    description: 'Type of subject plan',
    enum: ['elective'],
  })
  @IsOptional()
  @IsEnum(['elective'])
  type?: 'elective';

  @ApiPropertyOptional({
    description: 'Plan ID',
    example: 'plan-123',
  })
  @IsOptional()
  @IsString()
  planId?: string;
}

export class CreateSubjectPlanDto {
  @ApiProperty({
    description: 'Subject ID',
    example: '93.42',
  })
  @IsString()
  @IsNotEmpty()
  subjectId: string;

  @ApiProperty({
    description: 'Section',
    example: 'A',
  })
  @IsString()
  @IsNotEmpty()
  section: string;

  @ApiPropertyOptional({
    description: 'Year',
    example: 3,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  year?: number | null;

  @ApiPropertyOptional({
    description: 'Semester',
    example: 1,
    minimum: 1,
    maximum: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2)
  semester?: number | null;

  @ApiPropertyOptional({
    description: 'Dependencies',
    example: ['93.42', '78.21'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dependencies?: string[] = [];

  @ApiPropertyOptional({
    description: 'Credits required',
    example: 120,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  creditsRequired?: number | null;
}

export class UpdateSubjectPlanDto {
  @ApiPropertyOptional({
    description: 'Section',
    example: 'A',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  section?: string;

  @ApiPropertyOptional({
    description: 'Annual',
    example: 3,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  year?: number | null;

  @ApiPropertyOptional({
    description: 'Semester',
    example: 1,
    minimum: 1,
    maximum: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2)
  semester?: number | null;

  @ApiPropertyOptional({
    description: 'Dependencies',
    example: ['93.42', '78.21'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dependencies?: string[];

  @ApiPropertyOptional({
    description: 'Credits required',
    example: 120,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  creditsRequired?: number | null;
}
