import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  ValidationPipe,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CreateOutfitDto } from '../dto/outfit.dto';

@Injectable()
export class OutfitUploadService {
  private readonly validation = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
  });

  async parse(
    request: FastifyRequest,
  ): Promise<{ data: CreateOutfitDto; image: Buffer }> {
    if (!request.isMultipart())
      throw new UnsupportedMediaTypeException(
        'multipart/form-data 요청이 필요합니다.',
      );
    let image: Buffer | undefined;
    let metadata: unknown;
    let hasData = false;
    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          const bytes = await part.toBuffer();
          if (part.fieldname !== 'image' || image)
            throw new BadRequestException('image 파일 1개만 허용합니다.');
          image = bytes;
        } else {
          if (part.fieldname !== 'data' || hasData)
            throw new BadRequestException('data 필드 1개만 허용합니다.');
          hasData = true;
          if (part.valueTruncated)
            throw new PayloadTooLargeException('코디 입력이 너무 큽니다.');
          try {
            metadata =
              typeof part.value === 'string'
                ? (JSON.parse(part.value) as unknown)
                : part.value;
          } catch {
            throw new BadRequestException('data는 올바른 JSON이어야 합니다.');
          }
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        error.code.startsWith('FST_')
      ) {
        if (
          [
            'FST_REQ_FILE_TOO_LARGE',
            'FST_FILES_LIMIT',
            'FST_FIELDS_LIMIT',
            'FST_PARTS_LIMIT',
          ].includes(error.code)
        )
          throw new PayloadTooLargeException(
            '사진은 최대 8MB, 파일과 data는 각각 1개만 허용합니다.',
          );
        throw new BadRequestException('잘못된 multipart 요청입니다.');
      }
      throw error;
    }
    if (
      !image?.length ||
      !hasData ||
      !metadata ||
      typeof metadata !== 'object' ||
      Array.isArray(metadata)
    )
      throw new BadRequestException('사진과 코디 입력이 필요합니다.');
    const data = (await this.validation.transform(metadata, {
      type: 'body',
      metatype: CreateOutfitDto,
    })) as CreateOutfitDto;
    return { data, image };
  }
}
