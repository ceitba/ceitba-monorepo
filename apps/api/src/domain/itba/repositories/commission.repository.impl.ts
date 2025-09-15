import { Commission, CommissionTime, SubjectType, DayOfWeek } from '@/domain/itba/models/commission.model';
import { CommissionRepository } from '@/domain/itba/interfaces/repositories/commission.repository.interface';
import { GenericDomainException } from '@/shared/exceptions';
import { PrismaService } from '@/shared/database/prisma.service';

export class CommissionRepositoryImpl implements CommissionRepository {
    private readonly prisma: PrismaService;

    constructor(prisma: PrismaService) {
        this.prisma = prisma;
    }

    async findAll(): Promise<Commission[]> {
        const commissions = await this.prisma.commission.findMany({
            include: {
                times: true
            },
            orderBy: { subjectCode: 'asc' }
        });

        return commissions.map(this.mapToCommission);
    }

    async findById(id: string): Promise<Commission | null> {
        const commission = await this.prisma.commission.findUnique({
            where: { id },
            include: {
                times: true
            }
        });

        if (!commission) {
            return null;
        }

        return this.mapToCommission(commission);
    }

    async findBySubjectCode(subjectCode: string): Promise<Commission[]> {
        const commissions = await this.prisma.commission.findMany({
            where: { subjectCode },
            include: {
                times: true
            },
            orderBy: { commissionName: 'asc' }
        });

        return commissions.map(this.mapToCommission);
    }

    async findActiveCommissions(): Promise<Commission[]> {
        const today = new Date();

        const commissions = await this.prisma.commission.findMany({
            where: {
                courseStart: { lte: today },
                courseEnd: { gte: today }
            },
            include: {
                times: true
            },
            orderBy: { subjectCode: 'asc' }
        });

        return commissions.map(this.mapToCommission);
    }

    async findByCommissionName(commissionName: string): Promise<Commission[]> {
        const commissions = await this.prisma.commission.findMany({
            where: { commissionName },
            include: {
                times: true
            },
            orderBy: { subjectCode: 'asc' }
        });

        return commissions.map(this.mapToCommission);
    }

    async create(commission: Commission): Promise<Commission> {
        const created = await this.prisma.commission.create({
            data: {
                id: commission.id,
                subjectCode: commission.subjectCode,
                commissionName: commission.commissionName,
                courseStart: commission.courseStart,
                courseEnd: commission.courseEnd,
                enrolledStudents: commission.enrolledStudents,
                quota: commission.quota,
                subjectType: commission.subjectType,
                times: {
                    create: commission.times.map(time => ({
                        day: time.day,
                        classroom: time.classroom,
                        building: time.building,
                        hourFrom: time.hourFrom,
                        hourTo: time.hourTo
                    }))
                }
            },
            include: {
                times: true
            }
        }).catch(err => {
            throw new GenericDomainException(`Failed to create commission: ${err.message}`, err);
        });

        return this.mapToCommission(created);
    }

    async update(commission: Commission): Promise<Commission> {
        const updated = await this.prisma.commission.update({
            where: { id: commission.id },
            data: {
                subjectCode: commission.subjectCode,
                commissionName: commission.commissionName,
                courseStart: commission.courseStart,
                courseEnd: commission.courseEnd,
                enrolledStudents: commission.enrolledStudents,
                quota: commission.quota,
                subjectType: commission.subjectType,
                times: {
                    deleteMany: {},
                    create: commission.times.map(time => ({
                        day: time.day,
                        classroom: time.classroom,
                        building: time.building,
                        hourFrom: time.hourFrom,
                        hourTo: time.hourTo
                    }))
                }
            },
            include: {
                times: true
            }
        }).catch(err => {
            throw new GenericDomainException(`Failed to update commission: ${err.message}`, err);
        });

        return this.mapToCommission(updated);
    }

    async delete(id: string): Promise<void> {
        await this.prisma.commission.delete({
            where: { id }
        }).catch(err => {
            throw new GenericDomainException(`Failed to delete commission: ${err.message}`, err);
        });
    }

    async upsert(commission: Commission): Promise<Commission> {
        const upserted = await this.prisma.commission.upsert({
            where: { id: commission.id },
            update: {
                subjectCode: commission.subjectCode,
                commissionName: commission.commissionName,
                courseStart: commission.courseStart,
                courseEnd: commission.courseEnd,
                enrolledStudents: commission.enrolledStudents,
                quota: commission.quota,
                subjectType: commission.subjectType,
                times: {
                    deleteMany: {},
                    create: commission.times.map(time => ({
                        day: time.day,
                        classroom: time.classroom,
                        building: time.building,
                        hourFrom: time.hourFrom,
                        hourTo: time.hourTo
                    }))
                }
            },
            create: {
                id: commission.id,
                subjectCode: commission.subjectCode,
                commissionName: commission.commissionName,
                courseStart: commission.courseStart,
                courseEnd: commission.courseEnd,
                enrolledStudents: commission.enrolledStudents,
                quota: commission.quota,
                subjectType: commission.subjectType,
                times: {
                    create: commission.times.map(time => ({
                        day: time.day,
                        classroom: time.classroom,
                        building: time.building,
                        hourFrom: time.hourFrom,
                        hourTo: time.hourTo
                    }))
                }
            },
            include: {
                times: true
            }
        }).catch(err => {
            throw new GenericDomainException(`Failed to upsert commission: ${err.message}`, err);
        });

        return this.mapToCommission(upserted);
    }

    async upsertMany(commissions: Commission[]): Promise<Commission[]> {
        const results: Commission[] = [];

        for (const commission of commissions) {
            const result = await this.upsert(commission);
            results.push(result);
        }

        return results;
    }

    private mapToCommission(data: any): Commission {
        const times = data.times?.map((time: any) => new CommissionTime(
            time.courseId,
            time.day as DayOfWeek,
            time.classroom,
            time.building,
            time.hourFrom,
            time.hourTo
        )) || [];

        return new Commission(
            data.id,
            data.subjectCode,
            data.commissionName,
            data.courseStart,
            data.courseEnd,
            data.enrolledStudents,
            data.quota,
            data.subjectType as SubjectType,
            times
        );
    }
}
