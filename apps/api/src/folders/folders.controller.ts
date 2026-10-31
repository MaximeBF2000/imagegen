import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { writeZip } from '../common/zip.js';
import { FoldersService, type ImageScope } from './folders.service.js';

class FolderNameDto {
  @ApiProperty({ example: 'Product shots' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;
}

class ArchiveSelectionDto {
  @ApiProperty({ type: [String], description: 'Image (job) ids' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @IsUUID('all', { each: true })
  ids: string[];
}

@ApiTags('folders')
@Controller()
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get('folders')
  @ApiOperation({ summary: 'List folders with image counts and cover images' })
  list() {
    return this.folders.list();
  }

  @Post('folders')
  @ApiOperation({ summary: 'Create a folder' })
  create(@Body() dto: FolderNameDto) {
    return this.folders.create(dto.name);
  }

  @Get('folders/:id')
  @ApiOperation({ summary: 'Get a folder' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.folders.get(id);
  }

  @Patch('folders/:id')
  @ApiOperation({ summary: 'Rename a folder' })
  rename(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FolderNameDto) {
    return this.folders.rename(id, dto.name);
  }

  @Delete('folders/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a folder (images are kept unless deleteImages=true)' })
  @ApiQuery({ name: 'deleteImages', required: false, type: Boolean })
  async remove(@Param('id', ParseUUIDPipe) id: string, @Query('deleteImages') deleteImages?: string) {
    await this.folders.remove(id, deleteImages === 'true' || deleteImages === '1');
  }

  @Get('folders/:id/archive')
  @ApiOperation({ summary: 'Download every image of a folder as a .zip (with a manifest.json of prompts & seeds)' })
  async folderArchive(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    await this.sendArchive({ folderId: id }, res);
  }

  @Get('archive')
  @ApiOperation({ summary: 'Download images as a .zip: all, or a folder ("none" = unfiled)' })
  @ApiQuery({ name: 'folderId', required: false })
  async archive(@Query('folderId') folderId: string | undefined, @Res() res: Response) {
    await this.sendArchive({ folderId: folderId || undefined }, res);
  }

  @Post('archive')
  @ApiOperation({ summary: 'Download a selection of images (job ids) as a .zip' })
  async selectionArchive(@Body() dto: ArchiveSelectionDto, @Res() res: Response) {
    await this.sendArchive({ ids: dto.ids }, res);
  }

  private async sendArchive(scope: ImageScope, res: Response) {
    const { name, entries } = this.folders.archive(scope);
    res.status(200);
    res.attachment(`${name}.zip`);
    res.type('application/zip');
    await writeZip(res, entries);
  }
}
