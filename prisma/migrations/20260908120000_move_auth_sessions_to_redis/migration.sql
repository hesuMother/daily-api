-- 기기 식별자가 없는 기존 DB 세션은 재로그인으로 전환합니다.
-- 사용자/감사 로그는 보존하고 인증 세션 저장소만 Redis로 옮깁니다.
DROP TABLE "refresh_tokens";
DROP TABLE "auth_sessions";
