import { Controller, Get, Post, Put, Delete, Param, Req, HttpCode, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WikiBookmarkService } from '@/domain/itba/services/wiki-bookmark.service';

@ApiTags('Wiki')
@Controller('v1/wiki/bookmarks')
export class WikiBookmarkController {
    constructor(private readonly wikiBookmarkService: WikiBookmarkService) { }

    @ApiOperation({ summary: 'Estyado de bookmark del usuario y conteo global' })
    @Get(':subjectId')
    async get(@Param('subjectId') subjectId: string, @Req() req: any) {
        const userId = req.user?.id as string | undefined; // no estopy seguro de esto
        return this.wikiBookmarkService.getState(subjectId, userId);
    }

    @ApiOperation({ summary: 'Crear bookmark (usuario actual)' })
    @ApiBearerAuth()
    @Post(':subjectId')
    async create(@Param('subjectId') subjectId: string, @Req() req: any) {
        const userId = req.user?.id as string | undefined;
        if (!userId) throw new UnauthorizedException();
        return this.wikiBookmarkService.create(subjectId, userId);
    }

    @ApiOperation({ summary: 'Setear bookmark ON (idempotente)' })
    @ApiBearerAuth()
    @Put(':subjectId')
    async set(@Param('subjectId') subjectId: string, @Req() req: any) {
        const userId = req.user?.id as string | undefined;
        if (!userId) throw new UnauthorizedException();
        return this.wikiBookmarkService.set(subjectId, userId);
    }

    @ApiOperation({ summary: 'Eliminar bookmark' })
    @ApiBearerAuth()
    @HttpCode(204)
    @Delete(':subjectId')
    async remove(@Param('subjectId') subjectId: string, @Req() req: any) {
        const userId = req.user?.id as string | undefined;
        if (!userId) throw new UnauthorizedException();
        await this.wikiBookmarkService.remove(subjectId, userId);
    }
}
