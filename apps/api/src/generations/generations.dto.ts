import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ASPECT_RATIOS } from '../providers/types.js';

export const ASPECT_OPTIONS = [...ASPECT_RATIOS, 'auto'] as const;

export class CreateGenerationDto {
  @ApiProperty({ example: 'A cozy wooden cabin in a snowy forest at dusk, warm light in the windows' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  prompt: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 8, default: 1, description: 'Number of variants (one job each, different seeds)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  count?: number;

  @ApiPropertyOptional({ enum: ASPECT_OPTIONS, description: 'Defaults to "1:1", or "auto" (match input) when input images are given' })
  @IsOptional()
  @IsIn(ASPECT_OPTIONS)
  aspectRatio?: (typeof ASPECT_OPTIONS)[number];

  @ApiPropertyOptional({ description: 'Base seed; variant i uses seed + i. Random when omitted.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  seed?: number;

  @ApiPropertyOptional({ type: [String], description: 'Asset ids (from POST /api/assets) used as input/reference images' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsUUID('all', { each: true })
  inputImageIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Inline input images (data URLs, base64 or http(s) URLs). Convenient for automations — uploaded for you.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  inputImages?: string[];

  @ApiPropertyOptional({ description: 'Inpainting mask asset id, applied to the first input image (white = repaint)' })
  @IsOptional()
  @IsUUID()
  maskId?: string;

  @ApiPropertyOptional({ description: 'Inline inpainting mask (data URL / base64 / URL)' })
  @IsOptional()
  @IsString()
  mask?: string;

  @ApiPropertyOptional({ default: false, description: 'Rewrite the prompt with the LLM prompt enhancer before generating' })
  @IsOptional()
  @IsBoolean()
  enhance?: boolean;

  @ApiPropertyOptional({ description: 'Free label to group/find generations (e.g. an automation batch name)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional({ type: Object, description: 'Arbitrary JSON stored with the generation and returned as-is' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Folder to generate into (from POST /api/folders); images can be moved later' })
  @IsOptional()
  @IsUUID()
  folderId?: string;
}

export class UpdateGenerationDto {
  @ApiPropertyOptional({ nullable: true, description: 'Move all images of the generation to this folder (null = no folder)' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  folderId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  label?: string | null;
}

export class MoveImagesDto {
  @ApiProperty({ type: [String], description: 'Image (job) ids, as found in generation.jobs[].id' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];

  @ApiProperty({ nullable: true, description: 'Target folder id, or null for "no folder"' })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  folderId: string | null;
}

export class BulkCreateGenerationsDto {
  @ApiProperty({ type: [CreateGenerationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateGenerationDto)
  items: CreateGenerationDto[];
}

export class ListGenerationsQuery {
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Opaque cursor from a previous page (nextCursor)' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Full-text filter on prompt / label' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Exact label filter' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({
    description: 'Folder id, or "none" for images without a folder. Returns generations with at least one image in it; filter `jobs[].folderId` client-side.',
  })
  @IsOptional()
  @IsString()
  folderId?: string;
}
