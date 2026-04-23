import jwt from "jsonwebtoken";

// @MX:NOTE JWT 페이로드 타입 정의 (device_id 바인딩 포함, SPEC-JWT-DEVICE-BINDING-001)
export interface JwtPayload {
  user_id: string;
  username: string;
  role: string;
  // @MX:NOTE [AUTO] 디바이스 바인딩: 토큰 발급 시 기기 식별자 포함 (REQ-DB-001)
  device_id: string;
}

// @MX:NOTE JWT 시크릿 키: 환경변수 우선, 없으면 폴백 키 사용 (운영 환경에서는 반드시 JWT_SECRET 설정 필요)
const JWT_SECRET = process.env.JWT_SECRET || "vsync-jwt-secret-change-in-production";

// @MX:ANCHOR JWT 액세스 토큰 생성 (만료 없음, REQ-DB-002)
// @MX:REASON 모든 로그인 요청에서 사용, 인증의 핵심 함수
export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET);
}

// @MX:ANCHOR JWT 토큰 검증 및 디코딩
// @MX:REASON 모든 JWT 인증 요청에서 호출, fan_in >= 3
export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded as JwtPayload;
  } catch {
    return null;
  }
}
