import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  OutfitRepository,
  type OutfitViewer,
} from '../repository/outfit.repository';
import { OutfitImageStore } from '../upload/outfit-image.store';
import type {
  CreateOutfitDto,
  PageQueryDto,
  ReviewOutfitDto,
} from '../dto/outfit.dto';

@Injectable()
export class OutfitService {
  private readonly logger = new Logger(OutfitService.name);
  constructor(
    private readonly repository: OutfitRepository,
    private readonly images: OutfitImageStore,
  ) {}

  async create(authorId: string, data: CreateOutfitDto, image: Buffer) {
    const id = randomUUID();
    await this.images.save(id, image);
    try {
      return await this.repository.create(id, authorId, data);
    } catch (error) {
      try {
        await this.images.remove(id);
      } catch {
        this.logger.error(`Failed to remove unused outfit image: ${id}`);
      }
      throw error;
    }
  }

  detail(id: string, viewer?: OutfitViewer) {
    return this.repository.detail(id, viewer);
  }
  list(
    query: PageQueryDto,
    scope: 'public' | 'mine' | 'pending',
    authorId?: string,
  ) {
    return this.repository.list(query, scope, authorId);
  }
  review(id: string, reviewerId: string, data: ReviewOutfitDto) {
    return this.repository.review(id, reviewerId, data);
  }
  async image(id: string, viewer?: OutfitViewer): Promise<Buffer> {
    await this.repository.detail(id, viewer);
    return this.images.read(id);
  }
}
