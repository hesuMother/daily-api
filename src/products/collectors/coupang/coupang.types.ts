// 공식 파트너스 검색 API 문서 확인 전에는 응답 필드명을 확정하지 않습니다.
export type CoupangSearchResponse = unknown;

export interface CoupangSearchQuery {
  keyword: string;
}

export interface CoupangSignedRequest {
  url: URL;
  headers: Record<string, string>;
}

export class CoupangProtocolNotConfiguredError extends Error {
  constructor() {
    super(
      'Coupang Partners API contract requires official documentation; see docs/product-sync.md',
    );
  }
}

export class CoupangApiError extends Error {
  constructor(
    readonly kind: 'http' | 'network' | 'response' | 'api' | 'rate-limit',
    readonly status?: number,
  ) {
    // 원본 응답/요청/인증 헤더는 에러 메시지에도 포함하지 않습니다.
    super(`Coupang API ${kind} failure${status ? ` (${status})` : ''}`);
  }
}
