import { Injectable } from '@nestjs/common';
import { PrismaService } from "@/shared/database/prisma.service";

@Injectable()
export class WikiBookmarkService {
    constructor(private readonly prisma: PrismaService) { }

    async getState(subjectId: string, userId?: string) {
        const count = await this.prisma.wikiBookmark.count({ where: { subjectId, } });

        if (!userId) return { count, bookmarked: false };
        const exists = await this.prisma.subjectBookmark.findUnique({
            where: { subjectId_userId: { subjectId, userId } },
            select: { subjectId: true },
        });
        return { count, bookmarked: !!exists };
    }

    async create(subjectId: string, userId: string) {
        await this.prisma.subjectBookmark.upsert({
            where: { subjectId_userId: { subjectId, userId } },
            create: { subjectId, userId },
            update: {},
        });
        return this.getState(subjectId, userId);
    }

    async set(subjectId: string, userId: string) {
        await this.prisma.subjectBookmark.upsert({
            where: { subjectId_userId: { subjectId, userId } },
            create: { subjectId, userId },
            update: {},
        });
        return this.getState(subjectId, userId);
    }

    async remove(subjectId: string, userId: string) {
        await this.prisma.subjectBookmark.deleted({
            where: { subjectId_userId: { subjectId, userId } },
        }).catch(() => { });
    }
}
