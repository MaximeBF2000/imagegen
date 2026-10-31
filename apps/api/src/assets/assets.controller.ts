import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { Response } from 'express';
import { slugify } from '../common/zip.js';
import { DatabaseService } from '../db/database.service.js';
import { AssetsService } from './assets.service.js';

class CreateAssetJsonDto {
  @ApiProperty({ description: 'Image as a data URL, raw base64, or an http(s) URL to fetch' })
  @IsOptional()
  @IsString()
  data?: string;

  @ApiPropertyOptional({ enum: ['upload', 'mask'], default: 'upload' })
  @IsOptional()
  @IsIn(['upload', 'mask'])
  kind?: 'upload' | 'mask';
}

@ApiTags('assets')
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly db: DatabaseService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Upload images',
    description:
      'multipart/form-data with one or more `files` (and optional `kind=mask`), or JSON `{ "data": "<data-url | base64 | https url>" }`. Returns the stored assets.',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        kind: { type: 'string', enum: ['upload', 'mask'] },
        data: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FilesInterceptor('files', 8, { limits: { fileSize: 30 * 1024 * 1024 } }))
  async upload(@UploadedFiles() files: Express.Multer.File[] | undefined, @Body() body: CreateAssetJsonDto) {
    const kind = body?.kind === 'mask' ? 'mask' : 'upload';
    if (files?.length) {
      const rows = [];
      for (const f of files) rows.push(await this.assets.save(f.buffer, kind));
      return rows.map((r) => this.assets.toDto(r));
    }
    if (body?.data) return [this.assets.toDto(await this.assets.saveFromString(body.data, kind))];
    throw new BadRequestException('Send multipart `files` or a JSON `data` field');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Asset metadata' })
  meta(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.toDto(this.assets.get(id));
  }

  @Get(':id/file')
  @ApiOperation({ summary: 'Original image file (add ?download=1 to download)' })
  file(@Param('id', ParseUUIDPipe) id: string, @Query('download') download: string | undefined, @Res() res: Response) {
    const row = this.assets.get(id);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (download) {
      res.attachment(this.downloadName(row.id, row.file));
    }
    res.type(row.mime).sendFile(this.assets.filePath(row));
  }

  @Get(':id/thumb')
  @ApiOperation({ summary: 'WebP thumbnail (640px wide)' })
  async thumb(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.assets.thumbnailPath(this.assets.get(id));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('image/webp').sendFile(file);
  }

  /** "a-cozy-cabin-in-the-woods-2.png" style file names for generated images. */
  private downloadName(assetId: string, file: string) {
    const ext = file.split('.').pop();
    const row = this.db.get<{ prompt: string; idx: number }>(
      `SELECT g.prompt, j.idx FROM jobs j JOIN generations g ON g.id = j.generation_id WHERE j.asset_id = ?`,
      assetId,
    );
    if (!row) return file;
    const slug = slugify(row.prompt);
    return `${slug || 'image'}-${row.idx + 1}.${ext}`;
  }
}
