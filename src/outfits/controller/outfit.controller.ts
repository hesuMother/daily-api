import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  OptionalAuth,
  Public,
} from '../../auth/decorators/auth.decorators';
import type { AuthRequest } from '../../auth/auth.types';
import type { AuthUserDto } from '../../auth/dto/auth-response.dto';
import { CreateOutfitDto, PageQueryDto } from '../dto/outfit.dto';
import { OutfitService } from '../service/outfit.service';
import { OutfitUploadService } from '../upload/outfit-upload.service';

@ApiTags('Outfits')
@ApiExtraModels(CreateOutfitDto)
@Controller('outfits')
export class OutfitController {
  constructor(
    private readonly outfits: OutfitService,
    private readonly upload: OutfitUploadService,
  ) {}

  @Post()
  @ApiBearerAuth('accessToken')
  @ApiOperation({ summary: '사진과 코디 등록 (검수 대기)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image', 'data'],
      properties: {
        image: { type: 'string', format: 'binary' },
        data: {
          type: 'string',
          description:
            'CreateOutfitDto JSON. name, height, weight, items 필수.',
        },
      },
    },
  })
  @RouteConfig({
    rateLimit: { max: 10, timeWindow: '1 minute' },
    bodyLimit: 9 * 1024 * 1024,
  })
  async create(@CurrentUser() user: AuthUserDto, @Req() request: AuthRequest) {
    const { data, image } = await this.upload.parse(request);
    return this.outfits.create(user.id, data, image);
  }

  @Get()
  @Public()
  @ApiOperation({ summary: '승인된 코디 목록' })
  list(@Query() query: PageQueryDto) {
    return this.outfits.list(query, 'public');
  }

  @Get('mine')
  @ApiBearerAuth('accessToken')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '내 코디 목록 (대기·승인·반려 포함)' })
  mine(@CurrentUser() user: AuthUserDto, @Query() query: PageQueryDto) {
    return this.outfits.list(query, 'mine', user.id);
  }

  @Get(':id/image')
  @OptionalAuth()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: '코디 사진. 비공개 코디는 작성자·관리자 토큰 필요.',
  })
  async image(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthRequest,
  ) {
    return new StreamableFile(
      await this.outfits.image(id, request.auth?.user),
      { type: 'image/webp', disposition: 'inline' },
    );
  }

  @Get(':id')
  @OptionalAuth()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: '코디 상세. 비공개 코디는 작성자·관리자 토큰 필요.',
  })
  detail(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthRequest) {
    return this.outfits.detail(id, request.auth?.user);
  }
}
