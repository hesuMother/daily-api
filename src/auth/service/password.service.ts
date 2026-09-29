import { Injectable, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash!: string;

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(32).toString('base64url'));
  }

  hash(password: string): Promise<string> {
    return hash(password, {
      type: argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
  }

  async verify(
    storedHash: string | undefined,
    password: string,
  ): Promise<boolean> {
    // 존재하지 않는 계정도 Argon2 검증을 수행하여 계정 조회 시간 차이를 줄입니다.
    const matched = await verify(storedHash ?? this.dummyHash, password);
    return storedHash !== undefined && matched;
  }
}
