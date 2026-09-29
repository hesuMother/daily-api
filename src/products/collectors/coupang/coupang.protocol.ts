import { Injectable } from '@nestjs/common';
import type { ProductSyncSettings } from '../../../config/product-sync.config';
import {
  CoupangProtocolNotConfiguredError,
  type CoupangSearchQuery,
  type CoupangSearchResponse,
  type CoupangSignedRequest,
} from './coupang.types';

/**
 * 공식 문서로 확인되지 않은 부분만 격리한 경계입니다. 판매자 Open API 규격을
 * 대신 사용하지 않습니다. 확인 후 이 provider를 구현하면 나머지 흐름을 재사용합니다.
 */
@Injectable()
export class CoupangProtocol {
  assertConfigured(): void {
    throw new CoupangProtocolNotConfiguredError();
  }

  buildSearchRequest(
    query: CoupangSearchQuery,
    settings: ProductSyncSettings,
    now: Date,
  ): CoupangSignedRequest {
    // TODO: 공식 Partners 검색 endpoint, query encoding, HMAC 입력/시각/헤더 규격.
    void query;
    void settings;
    void now;
    throw new CoupangProtocolNotConfiguredError();
  }

  toCandidates(response: CoupangSearchResponse): unknown[] {
    // TODO: API 성공/오류 envelope 검사 후 실제 필드를 내부 모델 후보로 매핑.
    // 숫자 ID는 Number.isSafeInteger 확인 후 문자열로 변환해야 합니다.
    // 품절 필드가 없다면 isSoldOut을 생략하고 기존 상태를 보존합니다.
    // 응답 구조/API 전체 오류는 CoupangApiError를 throw하며 빈 배열로 숨기지 않습니다.
    void response;
    throw new CoupangProtocolNotConfiguredError();
  }
}
