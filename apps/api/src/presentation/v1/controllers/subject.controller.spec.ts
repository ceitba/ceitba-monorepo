import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SubjectController } from './subject.controller';
import { SubjectService } from '@/domain/itba/services/subject.service';
import { Subject } from '@/domain/itba/models/subject.model';

const buildSubject = (id = '93.42', name = 'Cálculo I', credits = 6) =>
    new Subject(id, name, credits);

describe('SubjectController', () => {
    let controller: SubjectController;
    let subjectService: jest.Mocked<SubjectService>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [SubjectController],
            providers: [
                {
                    provide: SubjectService,
                    useValue: {
                        getAllSubjects: jest.fn(),
                        getSubjectsByName: jest.fn(),
                        getSubjectById: jest.fn(),
                    },
                },
            ],
        }).compile();

        controller = module.get<SubjectController>(SubjectController);
        subjectService = module.get<SubjectService>(SubjectService) as jest.Mocked<SubjectService>;
    });

    describe('getSubjectById', () => {
        it('returns a subject when found', async () => {
            const subject = buildSubject('93.50', 'Probabilidad', 6);
            subjectService.getSubjectById.mockResolvedValue(subject);

            const result = await controller.getSubjectById('93.50');

            expect(subjectService.getSubjectById).toHaveBeenCalledWith('93.50');
            expect(result).toEqual({ id: '93.50', name: 'Probabilidad', credits: 6 });
        });

        it('throws NotFoundException when subject does not exist', async () => {
            subjectService.getSubjectById.mockResolvedValue(null);

            await expect(controller.getSubjectById('missing')).rejects.toBeInstanceOf(NotFoundException);
        });
    });
});
