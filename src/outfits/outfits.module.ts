import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { OutfitController } from './controller/outfit.controller';
import { OutfitAdminController } from './controller/outfit-admin.controller';
import { OutfitProductController } from './controller/outfit-product.controller';
import { OutfitRepository } from './repository/outfit.repository';
import { OutfitProductRepository } from './repository/outfit-product.repository';
import { OutfitService } from './service/outfit.service';
import { OutfitUploadService } from './upload/outfit-upload.service';
import { OutfitImageStore } from './upload/outfit-image.store';

@Module({
  imports: [DatabaseModule],
  controllers: [
    OutfitProductController,
    OutfitAdminController,
    OutfitController,
  ],
  providers: [
    OutfitRepository,
    OutfitProductRepository,
    OutfitService,
    OutfitUploadService,
    OutfitImageStore,
  ],
})
export class OutfitsModule {}
