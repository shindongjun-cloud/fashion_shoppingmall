// 개인정보 암호화 (서버 전용)
//
// - encrypt / decrypt : AES-256-GCM. 같은 값도 매번 다른 암호문이 나옵니다(IV가 무작위).
//   형식 "v1:<IV>:<인증태그>:<암호문>" (base64). 앞의 v1은 키 버전 → 나중에 키를 바꿀 때 v2를 추가하면
//   옛 데이터(v1)도 읽으면서 새 데이터는 v2로 저장할 수 있습니다.
// - blindIndex : HMAC-SHA256. 같은 값이면 항상 같은 해시 → "전화번호로 회원 찾기", 중복 가입 검사에 사용.
//   암호화 키와 다른 키를 씁니다(하나가 유출돼도 다른 하나는 안전하게).
//
// 키는 .env의 CUSTOMER_ENC_KEY, CUSTOMER_HASH_KEY (32바이트 base64). 절대 브라우저 코드에서 import 하지 마세요.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const VERSION = "v1";

function keyFrom(name: "CUSTOMER_ENC_KEY" | "CUSTOMER_HASH_KEY") {
  const raw = process.env[name];
  const key = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (key.length !== 32) {
    throw new Error(`${name}가 없거나 길이가 틀립니다 (32바이트 base64 필요). .env를 확인하세요.`);
  }
  return key;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12); // GCM 권장 12바이트
  const cipher = createCipheriv("aes-256-gcm", keyFrom("CUSTOMER_ENC_KEY"), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag(); // 위·변조 확인용
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decrypt(value: string): string {
  const [version, iv, tag, data] = value.split(":");
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new Error("지원하지 않는 암호문 형식입니다");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyFrom("CUSTOMER_ENC_KEY"), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64")); // 키가 다르거나 값이 바뀌었으면 여기서 실패
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/** null이면 null, 아니면 암호화 */
export const encryptOrNull = (plain: string | null | undefined) => (plain ? encrypt(plain) : null);
/** null이면 null, 아니면 복호화 */
export const decryptOrNull = (value: string | null | undefined) => (value ? decrypt(value) : null);

/**
 * 검색용 해시 (블라인드 인덱스). purpose를 섞어서 "전화번호 해시"와 "이메일 해시"가 서로 비교되지 않게 합니다.
 * 값은 미리 정규화해서 넣어야 같은 사람이 같은 해시가 됩니다 (normalizePhone, normalizeEmail).
 */
export function blindIndex(purpose: "phone" | "email" | "rejoin" | "toss-secret" | "ip", normalized: string): string {
  return createHmac("sha256", keyFrom("CUSTOMER_HASH_KEY")).update(`${purpose}:${normalized}`).digest("hex");
}

// ---------------------------------------------------------------
// 정규화 (같은 값을 같은 모양으로)
// ---------------------------------------------------------------
/** 010-1234-5678, 010 1234 5678 → 01012345678. 휴대폰 형식이 아니면 null */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^0-9]/g, "");
  return /^01[016789][0-9]{7,8}$/.test(digits) ? digits : null;
}
/** 앞뒤 공백 제거 + 소문자. 이메일 형식이 아니면 null */
export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

// ---------------------------------------------------------------
// 마스킹 (화면 표시용)
// ---------------------------------------------------------------
/** 홍길동 → 홍*동, 김철 → 김*, 남궁민수 → 남**수 */
export function maskName(name: string): string {
  const chars = [...name];
  if (chars.length <= 1) return "*";
  if (chars.length === 2) return `${chars[0]}*`;
  return chars[0] + "*".repeat(chars.length - 2) + chars[chars.length - 1];
}
/** 01012345678 → 010-****-5678 */
export function maskPhone(phone: string): string {
  const d = phone.replace(/[^0-9]/g, "");
  return d.length >= 10 ? `${d.slice(0, 3)}-****-${d.slice(-4)}` : "***";
}
/** hong.gildong@example.com → ho*******@example.com */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}
/** 상세 주소는 숨김: 서울 성동구 성수이로 ... → 그대로 + 상세 *** */
export function maskAddressDetail(detail: string | null): string {
  return detail ? "***" : "";
}
/** IPv4 마지막 자리 가림: 123.45.67.89 → 123.45.67.* / IPv6은 앞 4덩어리만 */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  // IPv4가 IPv6 형태로 들어오는 경우(::ffff:1.2.3.4)도 IPv4로 처리 (그대로 두면 원본 IP가 남음)
  const v4 = ip.trim().match(/^(?:::ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/i);
  if (v4) return `${v4[1]}.*`;
  // IPv6: "::" 생략을 펼친 뒤 앞 3묶음(네트워크 부분)만 남김. 예) 2001:db8::1 → 2001:db8:0:*
  if (!/^[0-9a-f:]+$/i.test(ip) || (ip.match(/::/g)?.length ?? 0) > 1) return null;
  const [head, tail] = ip.includes("::") ? ip.split("::") : [ip, null];
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === null ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  if (groups.length !== 8) return null;
  return `${groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}:*`;
}

/** 계좌번호 가리기: 끝 4자리만 남김 (110123456789 → ********6789) */
export function maskAccountNumber(account: string): string {
  const digits = account.replace(/[^0-9]/g, "");
  if (digits.length <= 4) return "*".repeat(digits.length || 1);
  return "*".repeat(digits.length - 4) + digits.slice(-4);
}
