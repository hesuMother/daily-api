// 모든 키는 같은 {userId} 해시 슬롯에 속하고 KEYS로 명시합니다.
// Redis TIME과 절대 만료 시각을 사용하여 회전해도 만료가 연장되지 않습니다.
export const CREATE_SESSION = `
local now = redis.call('TIME')
local expires = tonumber(ARGV[4])
if not expires or expires <= tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000) then return 0 end
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('SET', KEYS[2], ARGV[3] .. ':' .. ARGV[1], 'PXAT', ARGV[4])
redis.call('HSET', KEYS[1], 'sid', ARGV[1], 'jti', ARGV[2], 'exp', ARGV[4])
redis.call('PEXPIREAT', KEYS[1], ARGV[4])
return 1
`;

export const ROTATE_SESSION = `
if redis.call('HGET', KEYS[1], 'sid') ~= ARGV[1] then return 0 end
local expires = tonumber(redis.call('HGET', KEYS[1], 'exp'))
local now = redis.call('TIME')
if not expires or expires <= tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000) then
  redis.call('DEL', KEYS[1])
  return 0
end
if redis.call('GET', KEYS[2]) ~= ARGV[3] .. ':' .. ARGV[1] then return 0 end
if redis.call('HGET', KEYS[1], 'jti') ~= ARGV[2] then
  redis.call('DEL', KEYS[1])
  return 2
end
if redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
redis.call('SET', KEYS[3], ARGV[3] .. ':' .. ARGV[1], 'PXAT', expires)
redis.call('HSET', KEYS[1], 'jti', ARGV[4])
redis.call('PEXPIREAT', KEYS[1], expires)
return 1
`;

export const REVOKE_SESSION = `
if redis.call('HGET', KEYS[1], 'sid') ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`;

export const DISCARD_SESSION = `
if redis.call('HGET', KEYS[1], 'sid') == ARGV[1] then redis.call('DEL', KEYS[1]) end
if redis.call('GET', KEYS[2]) == ARGV[2] .. ':' .. ARGV[1] then redis.call('DEL', KEYS[2]) end
return 1
`;
