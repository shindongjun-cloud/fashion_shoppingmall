// 개인정보 암호화·해시·마스킹 단위 테스트
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blindIndex,
  decrypt,
  encrypt,
  maskEmail,
  maskIp,
  maskName,
  maskPhone,
  normalizeEmail,
  normalizePhone,
} from "../src/lib/crypto";

test("암호화한 값은 평문이 아니고, 복호화하면 원래 값", () => {
  const enc = encrypt("홍길동");
  assert.ok(!enc.includes("홍길동"));
  assert.match(enc, /^v1:[^:]+:[^:]+:[^:]+$/);
  assert.equal(decrypt(enc), "홍길동");
});

test("같은 값도 매번 다른 암호문 (IV가 무작위) → 암호문만 보고 같은 사람인지 알 수 없음", () => {
  assert.notEqual(encrypt("01012345678"), encrypt("01012345678"));
});

test("암호문을 조금이라도 바꾸면 복호화 실패 (인증 태그로 위·변조 감지)", () => {
  const enc = encrypt("01012345678");
  const [v, iv, tag, data] = enc.split(":");
  const tampered = Buffer.from(data, "base64");
  tampered[0] ^= 1;
  assert.throws(() => decrypt([v, iv, tag, tampered.toString("base64")].join(":")));
});

test("키가 다르면 복호화 실패", () => {
  const enc = encrypt("비밀");
  const original = process.env.CUSTOMER_ENC_KEY;
  process.env.CUSTOMER_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
  try {
    assert.throws(() => decrypt(enc));
  } finally {
    process.env.CUSTOMER_ENC_KEY = original;
  }
});

test("키가 없거나 길이가 틀리면 명확한 오류", () => {
  const original = process.env.CUSTOMER_ENC_KEY;
  process.env.CUSTOMER_ENC_KEY = "short";
  try {
    assert.throws(() => encrypt("x"), /CUSTOMER_ENC_KEY/);
  } finally {
    process.env.CUSTOMER_ENC_KEY = original;
  }
});

test("검색용 해시: 같은 값 → 같은 해시, 용도가 다르면 다른 해시", () => {
  const a = blindIndex("phone", "01012345678");
  assert.equal(a, blindIndex("phone", "01012345678"));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, blindIndex("email", "01012345678"));
});

test("정규화: 표기가 달라도 같은 번호·이메일", () => {
  assert.equal(normalizePhone("010-1234-5678"), "01012345678");
  assert.equal(normalizePhone("010 1234 5678"), "01012345678");
  assert.equal(normalizePhone("02-123-4567"), null, "휴대폰이 아님");
  assert.equal(normalizePhone("abc"), null);
  assert.equal(normalizeEmail("  Hong@Example.COM "), "hong@example.com");
  assert.equal(normalizeEmail("not-an-email"), null);
});

test("마스킹", () => {
  assert.equal(maskName("홍길동"), "홍*동");
  assert.equal(maskName("김철"), "김*");
  assert.equal(maskName("남궁민수"), "남**수");
  assert.equal(maskPhone("01012345678"), "010-****-5678");
  assert.equal(maskEmail("hong.gildong@example.com"), "ho**********@example.com");
  assert.equal(maskIp("123.45.67.89"), "123.45.67.*");
  assert.equal(maskIp(null), null);
  // IPv6 / IPv4가 IPv6 형태로 온 경우 (실제 로그인에서 ::1 이 "1:*"로 저장되던 버그)
  assert.equal(maskIp("::ffff:123.45.67.89"), "123.45.67.*", "원본 IPv4가 남으면 안 됨");
  assert.equal(maskIp("::1"), "0:0:0:*");
  assert.equal(maskIp("2001:db8::1"), "2001:db8:0:*", "끝부분(기기 식별)은 남기지 않음");
  assert.equal(maskIp("2001:0db8:85a3:0000:0000:8a2e:0370:7334"), "2001:db8:85a3:*");
  assert.equal(maskIp("not-an-ip"), null);
});
