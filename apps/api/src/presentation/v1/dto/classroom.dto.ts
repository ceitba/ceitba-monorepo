import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';

export class ClassroomQueryDto {
  @ApiPropertyOptional({
    description: 'Classroom status',
    enum: ['occupied', 'available'],
  })
  @IsOptional()
  @IsEnum(['occupied', 'available'])
  status?: 'occupied' | 'available';

  @ApiPropertyOptional({
    description: 'Current semester filter',
    example: 'true',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  current_semester?: boolean = true;
}

export class ClassroomConflictDto {
  @ApiProperty({
    description: 'Classroom name',
    example: '103R',
  })
  @IsString()
  @IsNotEmpty()
  classroom: string;

  @ApiProperty({
    description: 'Building',
    example: 'Building A',
  })
  @IsString()
  @IsNotEmpty()
  building: string;

  @ApiProperty({
    description: 'Day',
    example: 'Monday',
  })
  @IsString()
  @IsNotEmpty()
  day: string;

  @ApiProperty({
    description: 'Hour from',
    example: '09:00',
  })
  @IsString()
  @IsNotEmpty()
  hourFrom: string;

  @ApiProperty({
    description: 'Hour to',
    example: '11:00',
  })
  @IsString()
  @IsNotEmpty()
  hourTo: string;
}
