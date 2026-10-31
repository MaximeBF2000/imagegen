import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { type EnhanceMode, PromptEnhancerService } from './prompt-enhancer.service.js';

class EnhancePromptDto {
  @ApiProperty({ example: 'a cat on a roof at night' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  prompt: string;

  @ApiPropertyOptional({ enum: ['generate', 'edit', 'inpaint'], description: 'Defaults to "edit" when images are given' })
  @IsOptional()
  @IsIn(['generate', 'edit', 'inpaint'])
  mode?: EnhanceMode;

  @ApiPropertyOptional({ type: [String], description: 'Reference asset ids so the LLM can see the images' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsUUID('all', { each: true })
  imageIds?: string[];
}

@ApiTags('prompts')
@Controller('prompts')
export class PromptsController {
  constructor(private readonly enhancer: PromptEnhancerService) {}

  @Post('enhance')
  @HttpCode(200)
  @ApiOperation({ summary: 'Turn a vague idea into an optimized FLUX.2 prompt using an LLM' })
  async enhance(@Body() dto: EnhancePromptDto) {
    const prompt = await this.enhancer.enhance(dto.prompt, { mode: dto.mode, imageIds: dto.imageIds });
    return { prompt, original: dto.prompt };
  }
}
