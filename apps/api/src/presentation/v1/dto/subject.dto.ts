import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SubjectResponseDto {
    @ApiProperty({
        description: 'Subject identifier (plan code)',
        example: '93.42',
    })
    id!: string;

    @ApiProperty({
        description: 'Human-readable subject name',
        example: 'Cálculo I',
    })
    name!: string;

    @ApiProperty({
        description: 'Credit value assigned to the subject',
        example: 6,
    })
    credits!: number;
}
