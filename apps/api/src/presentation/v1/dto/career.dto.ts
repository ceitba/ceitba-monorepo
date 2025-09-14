import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateCareerDto {
  @ApiProperty({
    description: 'Career ID',
    example: 'career-123',
  })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({
    description: 'Career name',
    example: 'Computer Engineering',
  })
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class UpdateCareerDto {
  @ApiPropertyOptional({
    description: 'Career name',
    example: 'Computer Engineering',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;
}
