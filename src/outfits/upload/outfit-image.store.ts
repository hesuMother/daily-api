import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  mkdir,
  open,
  readFile,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import type { AppSettings } from '../../config/environment';

@Injectable()
export class OutfitImageStore {
  private readonly directory: string;
  constructor(config: ConfigService) {
    this.directory = resolve(
      config.getOrThrow<AppSettings>('app').outfitUploadDir,
    );
  }

  async save(id: string, input: Buffer): Promise<void> {
    let output: Buffer;
    try {
      const decoder = sharp(input, {
        limitInputPixels: 40000000,
        failOn: 'warning',
      });
      const info = await decoder.metadata();
      if (
        !['jpeg', 'png', 'webp'].includes(info.format ?? '') ||
        (info.pages ?? 1) !== 1
      )
        throw new Error('unsupported');
      // 파일명/MIME을 신뢰하지 않고 디코딩합니다. 재인코딩 시 EXIF/GPS를 제거합니다.
      output = await decoder
        .rotate()
        .resize({
          width: 2048,
          height: 2048,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw new BadRequestException(
        '정상적인 JPEG, PNG, WebP 사진을 업로드해주세요.',
      );
    }
    let file: FileHandle | undefined;
    try {
      await mkdir(this.directory, { recursive: true });
      file = await open(this.path(id), 'wx');
      await file.writeFile(output);
      await file.close();
    } catch {
      if (file) {
        await file.close().catch(() => undefined);
        await this.remove(id).catch(() => undefined);
      }
      throw new ServiceUnavailableException('사진을 저장할 수 없습니다.');
    }
  }

  async read(id: string): Promise<Buffer> {
    try {
      return await readFile(this.path(id));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        throw new NotFoundException('사진을 찾을 수 없습니다.');
      throw new ServiceUnavailableException('사진을 읽을 수 없습니다.');
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await unlink(this.path(id));
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ))
        throw error;
    }
  }

  private path(id: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(id))
      throw new BadRequestException('잘못된 사진 식별자입니다.');
    return join(this.directory, id + '.webp');
  }
}
