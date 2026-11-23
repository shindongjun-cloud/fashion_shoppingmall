# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project context

A portfolio/learning e-commerce site built step by step for a **coding beginner**. The user communicates in Korean, so replies and code comments are written in Korean, explaining concepts plainly. Build it incrementally: one step at a time, with a working, verifiable result after each step.

Roadmap: 0 setup ✅ → 1 product list/detail ✅ → 2 cart ✅ → 3 DB (Prisma + SQLite) ✅ → 4 GitHub login (Auth.js) ✅ → 5 order + Toss Payments **test mode** ✅ → 6 admin page (optional) → 7 deploy to Vercel (swap SQLite for Turso/Neon).

## 진행 상황과 작업 방식 (다른 컴퓨터에서 이어서 작업할 때 가장 먼저 읽기)

사용자는 학원 컴퓨터와 집 컴퓨터를 오가며 작업합니다. Claude의 메모(memory)는 컴퓨터마다 따로라서, 이어서 작업하는 데 필요한 내용은 모두 이 절에 적습니다. 도메인 하나를 끝낼 때마다 이 절을 갱신합니다. (마지막 갱신: 2026-11-23)

### 지금까지 한 것 (패션몰 = 단일 브랜드 공식몰)

| 순서 | 도메인 | 채택안 (사용자 선택) | 커밋 |
| --- | --- | --- | --- |
| 0 | 기본 셋업·상품·장바구니·DB·GitHub 로그인·토스 테스트 결제 | — | d0c4fdf |
| ① | 상품 | B안 3단 구조(Style → StyleColor → Sku) + A안 보강(19개 테이블) | 348d025 |
| ② | 가격 + DB 제약조건 v2 | C안(정가 이력 + 할인 행사, 판매가는 계산) | 13d6ddb |
| ③ | 재고 | B안(잔고·원장·예약·위치, 트리거가 잔고 갱신) | 1c9e11e |
| ④ | 고객 | B안(로그인 계정 User ≠ 쇼핑몰 고객 Customer, 개인정보 암호화) | 93175b8 |
| 결제 | 결제 | B안(시도 단위 Payment, 멱등 승인, UNKNOWN 확인, 보상 취소) | a1f57a9 |
| 결제 | 실사용 점검 + 로그인 상태 유지 | C안(미체크 시 브라우저 종료·12시간 로그아웃) | cbf7173 |
| ⑦ | 주문 | B안(주문 + 상품별 상태 + 출고 분리, 출고 시 재고 차감) | e1b4c3c |
| ⑦+ | 비회원 주문 | B안(주문번호 + 비밀번호 조회, 가입 후 회원 계정으로 가져오기) | c799659 |
| 재고 보강 | 발주·재입고 알림·반품 | 2안(발주·입고 전표, 재입고 예정일·알림, 재주문 알림, 반품 검수 → 재고 복귀 → 환불) | 5232478 |
| ⑬ | 쿠폰 | B안(정책·발급·사용 분리) + 주문당 1장·고객 직접 선택 | 2e8796e |
| 문서 | 주문 설계 정리 PDF + ERD | `docs/order-table-design.pdf`, `docs/erd/order-erd.drawio`, `docs/erd/full-erd.drawio` | 2fb8be3 |
| 문서 | 주문 도메인 피드백·답변 (보관) | `docs/order-feedback-2026-11-19.md` | 9d69050 |
| 재설계 | 고객 v1 정의서(B안, 참고용 보관) | `docs/redesign/01-customer.md` | f16bf1c |
| 재설계 | 고객 사용자 직접 진행 초안(26개 테이블) + 피드백 전 ERD | `docs/redesign/01-customer-draft-2026-11-23.md`, `docs/redesign/01-customer-erd.drawio` | 이 절과 같은 커밋 |

현재 규모: 테이블 82 · 컬럼 889 · FK 124 · CHECK 315 · 트리거 217 · 자동 테스트 437개.

### ⚠️ 새 세션을 시작하면 가장 먼저 (2026-11-23 갱신)

**지금은 5개 도메인(고객 → 상품 → 주문 → 결제 → 배송)을 처음부터 다시 설계하는 중입니다(재설계).** 사용자가 직접 참여해 채팅으로 진행하며, 기존 코드·스키마는 아직 바꾸지 않습니다(5개 도메인 설계가 끝난 뒤 반영).

1. 먼저 `docs/redesign/01-customer-draft-2026-11-23.md`(고객 도메인 최신 초안, 26개 테이블)를 읽습니다.
2. 사용자는 2026-11-23 마지막 답변을 다시 확인하기로 했습니다. 확인할 내용은 회원 탈퇴 관리, 사업자 소속 승인 설명, 등급 산정·이력의 상태 칸입니다. 사용자의 의견을 받아 초안을 고치고, 초안 문서의 "미결정·확인 필요" 목록 순서로 이어 갑니다(다음 주제: 휴면).
3. 표가 확정되면 ERD(draw.io)를 다시 만듭니다. 지금의 `01-customer-erd.drawio`는 피드백을 반영하기 전 판입니다.

### 재설계 진행 방식 (사용자가 정함, 항상 지킬 것)

- **선택지를 주지 않습니다**(AskUserQuestion이나 "A안/B안" 목록 금지). 사용자가 달라고 할 때만 줍니다. 채팅으로 이야기하며 진행하고, 추천이 있으면 하나만 이유와 함께 말합니다.
- ERD를 만들기 전까지는 plan mode로 진행합니다(파일 수정은 사용자가 요청할 때만).
- 사용자는 초보자입니다. 쉬운 말로 설명하고, 모르는 개념은 예시를 들어 설명합니다. 사용자가 생각하지 못한 경우의 수(예: 주문 중 탈퇴, 잠금 해제 방법)를 먼저 찾아 알려 줍니다.
- 테이블은 **키 | 논리명 | 물리명 | 설명** 표로 보여 주고, **모든 컬럼에 설명(이유)**을 빈칸 없이 적습니다.
- 법률 사항은 단정하지 않고 "검증 필요"로 표시합니다.
- 오늘 작업을 지우지 않습니다. 이전 설계 문서(v1, 기존 docs/)는 덮어쓰지 않고 새 파일로 만듭니다.

### 재설계 설계 규칙 (항상 지킬 것)

**이름 통일 규칙**

| 종류 | 논리명 | 물리명 | 예 |
| --- | --- | --- | --- |
| 식별자 | ○○ID | ○○Id. PK도 `id` 대신 전체 이름을 씁니다. | 비회원 조회 시도ID `guestLookupAttemptId` |
| 날짜+시각 | ○○ 일시 | ○○At | `lockedAt`, `consentedAt` |
| 날짜만 | ○○ 일자 | ○○Date | `birthDate`, `openedDate` |
| 예/아니오 | ○○ 여부 | is○○ | `isAdultConfirmed` |
| 종류 나누기 | ○○ 구분 | ○○Type | `memberType`, `addressType` |
| 횟수 / 수량 | ○○ 횟수 / ○○ 수량 | ○○Count / ○○Quantity | `failCount`, `couponQuantity` |
| 이유 | ○○ 사유 | ○○Reason | `changeReason`, `endReason` |
| 결과 | ○○ 결과 | ○○Result | `lookupResult`, `loginResult` |
| 상태 | ○○ 상태 (예: 회원 상태) | `status` (모든 테이블 같은 이름) | |
| 검색용 해시 | ○○ 검색값 | ○○Hash | `phoneHash`, `ciHash` |
| 가린 값 / IP | ○○ 표시값 / ○○ 접속 IP | ○○Masked / `ipMasked` | `accountNoMasked` |
| 정해 둔 기간 | ○○ 시작 일시 / ○○ 종료 일시 | startAt / endAt | 관리자 지정 등급 기간 |
| 실제로 끝난 때 | ○○ 종료 일시 | endedAt | 대표자 퇴임, 동의 종료 |
| 순번(복합 PK) | ○○ 순번 | ○○Seq | `addressSeq` (회원ID + 순번이 PK) |

- **논리명은 구체적으로** 씁니다. 예를 들어 "시도ID"가 아니라 "비회원 조회 시도ID", "최소 금액"이 아니라 "등급 달성 최소 실결제 금액"으로 씁니다.
- 같은 뜻의 칸은 모든 테이블에서 같은 이름을 씁니다.
- 회원 PK는 `memberId`, 비회원 PK는 `guestId`입니다. 값은 고객ID와 같습니다(고객과 1:1). 회원 전용 테이블은 `memberId`, 고객 공통 테이블은 `customerId`로 가리킵니다.
- 처리자ID처럼 회원·관리자·시스템이 섞이는 ID에는 FK를 걸지 않고 "처리자 구분"(○○ByType) 칸과 짝을 짓습니다. **키 칸에는 DB가 실제로 검사하는 제약(PK/FK/UK)만** 표시합니다.

**상태 칸 규칙**
- 값이 바뀌는 테이블에는 모두 상태 칸(`status`)을 둡니다.
- 고치지 않는 기록 테이블이라도, 기록 뒤에 이어지는 처리(적용, 지급 등)가 있으면 그 처리의 상태 칸을 둡니다. 예: 등급 산정 기록의 적용 상태, 등급 변경 이력의 혜택 지급 상태.
- 순수 기록(동의 이력, 변경 이력, 로그인·조회 시도 기록)에는 상태 칸 대신 행위·결과 칸이 있습니다.

**시스템 칸 규칙**
- **모든 테이블에 4개를 다 넣습니다**(사용자 결정, 기록 테이블도 예외 없음). 이름과 설명은 사용자가 정한 그대로 씁니다.

| 물리명 | 논리명 | 설명 |
| --- | --- | --- |
| createdAt (CREATED_AT) | 생성일시 | 데이터가 처음 생성된 시간 |
| createdBy (CREATED_BY) | 생성자 | 데이터를 생성한 사용자 |
| updatedAt (UPDATED_AT) | 수정일시 | 마지막으로 수정된 시간 |
| updatedBy (UPDATED_BY) | 수정자 | 마지막으로 수정한 사용자 |

- 생성자·수정자는 회원·관리자·시스템이 섞이므로 FK를 걸지 않습니다.
- 표에서는 **칸마다 한 줄씩** 적습니다(한 칸에 합쳐 적지 않습니다).
- 삭제 여부(행 삭제 또는 상태로 숨김)는 테이블마다 정합니다.

### 보관: 주문 도메인 피드백 "8. 정리" (재설계 후 다시 검토)

2026-11-19에 사용자가 주문 도메인에 준 피드백과 Claude의 답입니다. 전문은 `docs/order-feedback-2026-11-19.md`에 있습니다. 재설계로 방향이 바뀌어 지금은 결정을 받지 않고 보관만 합니다. 주문 도메인을 재설계할 때 참고합니다.

| # | 개선안 | 내용 |
| --- | --- | --- |
| ① | 변경자 기록 보강 | 주문·주문 상품 이력에 changedByCustomerId, changedByAdminId(관리자 테이블은 ⑥단계, 그전에는 처리자 문자열), reasonCode(사유 코드) 추가 |
| ② | "무엇이 바뀌었나" 기록 | A안: 이력에 changeType(STATUS/ADDRESS/RECIPIENT/OPTION…) + 변경 전·후 값(JSON). B안: 범용 OrderChangeLog(필드별 전·후) 신설. C안: B안 + 옵션(컬러·사이즈) 변경 기능(OrderItemOptionChange: 출고 준비 전·같은 가격 옵션만·재고 재예약·고객 동의·처리 직원) |
| ③ | 고객 유형·로그인 방식 | A안: Customer.customerType(MEMBER/GUEST) + 비회원 주문마다 GUEST 고객 행. B안: 비회원은 지금처럼 주문에, 회원 로그인 방식만 세분화(Account.provider + 자체 가입 CustomerCredential + 가입 경로). 장단점·제약·테스트는 고객 보강 설계안으로 따로 제시 |
| ④ | GitHub 접근 토큰 저장 중단 (발견한 문제) | Account.access_token이 평문 저장됨(쓰지 않는 값). 어댑터에서 저장 안 함 + 기존 값 삭제 + 테스트. 보안 조치라 바로 진행 추천 |
| ⑤ | 중복 칸 정리 여부 | OrderItem.paidAt, lineListTotal/lineDiscountTotal, Order.paidAt: 유지(조회 편의, CHECK로 일치) 또는 삭제 |
| ⑥ | 논리명 정정 | createdAt → "주문 일시" / "주문 상품 등록 일시" |
| ⑦ | 배송 추적 이벤트 | 집하·허브 경유 단계는 배송 도메인 설계안에 포함 |
| 추가 | 테이블 정의서 문서 | 모든 컬럼에 논리명·물리명·이유를 적은 정의서를 docs/에 작성할지 |

사용자가 남긴 표시 규칙: **테이블 정의를 보여 줄 때는 논리명(한글)·물리명을 나누고, 모든 컬럼에 "왜 이 테이블에 있나(이유)"를 빈칸 없이 적습니다.** 배송지·배송비 규칙·택배사 테이블 피드백은 배송 도메인을 만든 뒤에 받기로 했습니다.

### 다음 할 일 (순서대로)

0. **재설계 진행**: 고객(진행 중) → 상품 → 주문 → 결제 → 배송. 5개 도메인 설계가 끝나면 코드·스키마에 반영합니다. 아래 1~2번은 재설계 뒤로 미룹니다.
1. **⑭ 포인트** 설계안 제시 (다음 차례). Order.pointUsed, OrderItem.pointAllocated 칸은 이미 있음.
2. **⑩ 클레임**: 부분 수량 취소·교환, 배송지 변경 차액 환불, 부분 반품으로 쿠폰 최소 금액이 깨질 때 회수 여부, 고객 사유 전체 반품 시 쿠폰 복원 여부.
3. 미뤄 둔 것: 약관·동의, 장바구니·위시, `/my`의 `?error=` 플래시 방식 전환, 알림 이메일·카카오 발송, 도서산간 우편번호·택배사 조회 주소를 실제 계약 택배사 자료와 대조, 관리자 화면, 배포(Vercel).
4. **GitHub OAuth 비밀키 교체**: 사용자가 "다 끝나고 하자"고 함. 새 비밀키는 채팅에 붙여 넣지 않고 사용자가 `.env`에 직접 넣음.
5. 사용자가 참고 쇼핑몰 링크를 줄 예정. `docs/customer-design.*`, `docs/product-design.drawio`는 참고용 종합안이므로 링크를 받기 전에는 축소하지 않음.

### 사용자가 정한 작업 방식 (항상 지킬 것)

1. **도메인마다 설계안 먼저**: 실무형 설계안 2~3개를 제시합니다. 각 안마다 결과 예시, 장단점, 추천과 이유, 제약조건, 테스트 계획을 붙입니다. 사용자가 고르기 전에는 스키마를 수정하지 않습니다(미리 바꿨다가 거절당한 적 있음).
2. **"실무처럼"**: 그 테이블만 보지 말고 이미 만든 테이블(고객·결제·재고·주문·쿠폰…)과의 관계와 예외 상황(예: 결제 후 취소, 받은 뒤 반품, 비회원이 나중에 가입)까지 함께 설계합니다.
3. **DB 제약조건 필수**: `prisma/db-constraints.ts`에 추가 → 주입 → 백업 → 적용 → `db:verify` → 제약 테스트. 트리거를 지운 복사본에서 테스트가 실패하는지도 확인합니다. (제약 없이 만들었다가 처음부터 다시 하라는 지시를 받은 적 있음)
4. **테스트와 실제 확인**: 자동 테스트 + 버그 수정 + 실제 토스 테스트 결제(퀵계좌이체 데모, PIN 000000) + 화면 확인(PC·휴대폰 폭). 사용자가 생각 못한 경우의 수도 스스로 찾아서 시험합니다.
5. **문제는 전부 보고**: 작은 것까지 문제·원인·조치로 보고하고, 제 실수(테스트 실수, 오래된 서버로 시험 등)도 숨기지 않습니다.
6. **커밋·푸시는 먼저 묻기** (도메인 단위). 단, 사용자가 지시에 "커밋푸시까지"를 넣었으면 끝나고 바로 진행합니다. 원격 저장소: github.com/shindongjun-cloud/fashion_shoppingmall, 브랜치 main.
7. **안전**: 마이그레이션 전 `dev.db`를 `backups/`에 백업하고, 비밀키는 출력하지 않으며, `.env`는 커밋하지 않습니다.
8. **답변**: 한국어, 초보자도 이해할 쉬운 말, 코드 주석도 한국어. 결과 보고 때는 테이블 정의(테이블·컬럼·관계)를 보여 달라는 요청이 자주 있습니다.

### 도메인별 주요 결정 (사용자가 고른 세부 사항)

- **주문**: "결제 후 취소도 생각해야 한다" → 재고를 결제가 아니라 출고 때 차감. 고객 취소는 상품 준비 전까지만 가능하고, 출고 뒤에는 반품으로 처리. 배송지 변경은 추가 배송비가 같은 지역으로만 가능(서울 → 내륙 가능, 제주·섬은 불가).
- **비회원**: 주문번호 + 본인이 정한 비밀번호(6~20자)로 조회. 쿠폰·포인트 사용 불가. 회원가입 뒤에는 주문번호 + 비밀번호 또는 같은 브라우저로 회원 계정에 가져옴(휴대폰·이메일로 자동 연결하지 않음).
- **재고 보강**: 반품은 환불까지 이번에 구현(상품 줄 전체 수량 단위). 반품 배송비는 고객 사유면 편도 3,000원, 무료배송 기준이 깨지면 왕복. 반품 기간은 단순 변심 7일, 불량 30일. 알림은 사이트 알림함부터. 고객용 품절 임박 알림은 미룸.
- **쿠폰**: 상품·장바구니·배송비 쿠폰을 지원하되 **주문당 1장만**(중복 사용 불가, DB도 막음). 결제 화면은 **자동 선택 없이** 할인 금액이 큰 순서로 만료일과 함께 보여 주고 고객이 고름. 조건만 맞으면 할인 행사 상품에도 쓸 수 있음. 결제 전 이탈하면 바로 복원, 결제 후 전체 취소는 기간이 남았으면 복원, 부분 반품은 복원 없음.

### 다른 컴퓨터에서 처음 시작할 때

`dev.db`, `.env`, `backups/`는 Git에 올라가지 않습니다.

1. `git pull` → `npm install` (Node는 `C:\Program Files\nodejs`)
2. **`.env`는 Git에 없음**: USB로 옮기거나, `.env.example`을 복사해 새로 만듭니다(항목별로 구하는 방법이 적혀 있음). 새로 만들 때 Claude가 `AUTH_SECRET`·`CUSTOMER_ENC_KEY`·`CUSTOMER_HASH_KEY`는 만들어 주고, GitHub 키(새 Client secret 발급)와 토스 문서 테스트 키는 사용자가 직접 `.env`에 붙여 넣습니다(채팅에 붙여 넣지 않음). 암호화 키가 다르면 다른 컴퓨터 DB의 암호문은 읽을 수 없지만, DB도 새로 만들면 괜찮습니다. 비밀값을 출력하지 말고 이름만 확인합니다.
3. DB 새로 만들기: `npx prisma migrate deploy --config prisma7.config.ts` → `npx prisma generate --config prisma7.config.ts` → `npm run db:seed` → `npm run db:verify` → `npm test` (2026-11-18 빈 DB에서 확인: 오류 0, 테스트 437개 통과)
4. GitHub 로그인은 OAuth 앱 콜백이 `http://localhost:3000/api/auth/callback/github`이므로 어느 컴퓨터에서든 같은 `.env`로 동작합니다.
5. E2E 도구(playwright-core)와 일회용 스크립트는 Claude의 임시 폴더(scratchpad)에 있어서 컴퓨터를 옮기면 없습니다. 필요하면 다시 만듭니다.

## Commands

Node is installed at `C:\Program Files\nodejs`. Shells opened before the install may not have it on PATH. If so, run `export PATH="/c/Program Files/nodejs:$PATH"` (bash) first.

- `npm run dev`: dev server at http://localhost:3000
- `npm run build`: production build. The route table shows which routes are static (○) and which are dynamic (ƒ).
- `npm run lint`: ESLint. It includes `react-hooks/set-state-in-effect`, which rejects `setState` called directly inside `useEffect`.
- `npx tsc --noEmit`: type-check
- `npm run db:migrate`: `prisma migrate dev && prisma generate`. Run it after editing `prisma/schema.prisma`. In Prisma 7, `migrate` does **not** regenerate the client on its own.
  - `migrate dev` waits on an interactive prompt when a migration has data-loss warnings, and hangs in a non-interactive shell. Instead, run `prisma migrate dev --create-only --name x < /dev/null`, review the SQL, then run `prisma migrate deploy` and `prisma generate`.
  - A hung migrate leaves `schema-engine` processes holding the lock on `dev.db` ("database is locked"). Stop those processes before retrying.
- `npm run db:seed`: seeds masters (season/category/color/size/material/manufacturer/care symbol) + 6 sample styles (15 colors, 47 SKUs); skips if any `Style` exists. Coupon policies (7 samples, relative to seed time) are seeded separately and skipped if any `CouponPolicy` exists
  - `--create-only` also refuses to run in a non-interactive shell when there are data-loss warnings.
- **Migration workflow (required — DB constraints live outside Prisma)**:
  1. `npx prisma migrate diff --config prisma7.config.ts --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<ts>_<name>/migration.sql`
  2. `npm run db:constraints -- prisma/migrations/<ts>_<name>/migration.sql` — injects CHECKs into every `CREATE TABLE "X"`/`"new_X"` and drops/recreates affected triggers (including triggers on *other* tables that read a redefined table; otherwise SQLite aborts the RENAME with "no such table").
  3. Review the SQL (add data-migration statements by hand), **back up dev.db**, then `prisma migrate deploy` + `prisma generate`. SQLite migrations are not rolled back on failure — a failed migration leaves the DB half-applied (restore the backup, fix, regenerate).
  4. `npm run db:verify` — must pass (constraints present and identical to definitions, existing data valid, cross-row business rules). Then `npm test`.
  - Data-migration SQL must write dates as `strftime('%Y-%m-%dT%H:%M:%f+00:00','now')`, never `CURRENT_TIMESTAMP`.
  - When removing a column, remove its constraints from `db-constraints.ts`: SQLite treats an unknown `"name"` as a string literal, so a stale CHECK silently becomes always-false (this broke a migration once). `validateConstraints()` now fails `db:constraints`/`db:verify` on unknown columns.
  - Never edit an applied migration file (checksum). Adding an enum value needs a migration that recreates the table so its enum CHECK is regenerated — `db:verify` reports the stale CHECK.
- `npm run db:verify`: integrity check (see above). `npm test`: `tsx --test "tests/**/*.test.ts"` — `tests/pricing.test.ts` (pure unit tests of `computePrice`) and `tests/db-constraints.test.ts` (raw-SQL invalid writes must be rejected by the DB; runs against dev.db inside rolled-back transactions, needs seeded data), `tests/inventory.test.ts` (commits, so it runs on a temp copy via `tests/helpers/temp-db.ts` — import it first), `tests/payment.test.ts` (temp copy + `tests/helpers/fake-toss.ts`, an in-memory Toss with idempotency, already-processed, partial cancel, virtual accounts and fault injection: timeout-before/after, 5xx, error codes), `tests/inject-constraints.test.ts`.
- `npm run inventory:release-expired`: expire overdue reservations (to be run by cron after deploy).
- `npm run payments:jobs -- reconcile|deposits|cancels|webhooks|stale-orders|api-logs|all`: payment cron jobs (see Payment).
- `npm run inventory:ops -- po-create|po-order|po-confirm|po-date|po-cancel|receive|po-close|po-show|reorder-set|alerts|return-show|return-approve|return-reject|return-pickup|return-receive|return-inspect|return-refund ...`: purchasing, reorder and return admin commands (see Restock & returns). `npm run inventory:jobs -- low-stock|restock|return-refunds|all`.
- `npm run coupons:ops -- list|show|create <json>|activate|pause|resume|end|code-add|code-off|issue|revoke|customer ...`: coupon admin commands (see Coupons). `npm run coupons:jobs -- birthday|grade|expire|expiring|all`.
- `npm run orders:ship -- show|prepare|register|ship|deliver|cancel-shipment|cancel ...`: admin order commands until the admin page exists (see Order). `npm run orders:jobs -- auto-confirm|purge|all`: order cron jobs.
- `TEST_SOURCE_DB=<path> npm test`: run tests on a copy of another DB (e.g. one with triggers dropped, to prove the tests really exercise them).
- Rehearse migrations on a DB copy with a **Windows-style** path: `DATABASE_URL="file:$(cygpath -m <copy>)"`. A Git Bash path (`file:/c/...`) is read as `C:c...` and Prisma silently creates a new empty DB there. `tests/` is type-checked by `next build` too.
- `npm run db:studio`: GUI for viewing and editing the DB

Tests use Node's built-in runner via tsx (no extra framework). Also verify UI changes with a build plus `next start` and curl, or in the browser.

## Stack-specific gotchas

- **Next.js 16 / React 19**: see AGENTS.md above and read `node_modules/next/dist/docs/` before using unfamiliar APIs.
  - Page `params` is a Promise. Use the global `PageProps<"/route/[id]">` / `LayoutProps<"/">` types.
- **Prisma 7**:
  - The config file is `prisma7.config.ts`, not `prisma.config.ts`. It holds `DATABASE_URL` (via dotenv) and the seed command (`tsx prisma/seed.ts`).
  - The client is generated into `src/generated/prisma/` (gitignored) and imported from `@/generated/prisma/client`, not `@prisma/client`.
  - Client construction requires a driver adapter (`@prisma/adapter-better-sqlite3`). Always use the singleton exported from `src/lib/prisma.ts`.
  - `.agents/skills/prisma-*` contain Prisma's own reference docs, which are useful for Prisma 7 APIs.
- **npm allowScripts**: npm here does not run package install scripts unless they are approved. `better-sqlite3`, `@prisma/engines` and `esbuild` are approved in `package.json` `allowScripts`. A new native dependency needs `npm approve-scripts <pkg>`.
- **Tailwind v4**: configured in `src/app/globals.css` with `@import "tailwindcss"`; there is no tailwind.config. The site is light-theme only; the dark-mode media query was removed on purpose.

## DB constraints (prisma/db-constraints.ts)

- Prisma can't express CHECK constraints or triggers, so they are defined in `prisma/db-constraints.ts` (single source) and injected into migration SQL by `scripts/inject-constraints.ts`; `scripts/db-verify.ts` checks them. Prisma ignores them (`migrate diff` stays empty), but drops them whenever it recreates a table — hence step 2 of the workflow.
- SQLite specifics handled there: Prisma enums are plain TEXT (auto `IN (...)` CHECK per enum/Boolean field, parsed from schema.prisma); INTEGER columns accept text, so money/stock checks also test `typeof(x) = 'integer'`; dates are stored as TEXT `YYYY-MM-DDTHH:MM:SS.mmm+00:00` (UTC) so text comparison = time comparison — never write `CURRENT_TIMESTAMP` (different format) into date columns; date columns used in comparisons have a format CHECK.
- Cross-row rules are triggers: SKU/measurement/model sizes must belong to the style's size group; style size group can't change once SKUs exist; StyleColor can't move styles; StylePrice periods can't overlap (also guarantees one current price); RATE overrides 1–99; `Category.path`/`depth` are computed by an AFTER INSERT trigger (don't pass them; parent can't change).
- **Sale gate**: a `Style` cannot be inserted as `ON_SALE`; create it as `DRAFT`, add colors/SKUs/images/notice/materials/price, then update to `ON_SALE`. Trigger `Style_sale_ready_upd` rejects the transition (with a specific message) unless there is a current `StylePrice`, a `StyleNotice`, ≥1 sellable color, every sellable color has a SKU and a MAIN image, and materials exist with every part summing to 100. The seed does this in `openSales()` after `seedPricing()`. A notice can't be deleted while ON_SALE (suspend first). Other edits to an ON_SALE style are not re-checked at write time — `db:verify` reports drift.
- **Code consistency**: `StyleColor.code` must equal `styleCode-colorCode`, `Sku.skuCode` must equal `styleColor.code-sizeCode`, `Season.code` = last 2 digits of year + term. `styleCode`/`Color.code`/`Size.code` can't change once used.
- BEFORE triggers fire before CHECK/UNIQUE/FK, so a test meant for one constraint can be pre-empted by a trigger — pick a write only that constraint can reject.
- Delete rules: masters and promotion-target references are `Restrict` (a SetNull'd EXCLUDE target would silently start discounting the excluded style); `StylePrice` is `Restrict` (legal evidence for displayed discount rates).
- `StyleColor (styleId, sortOrder)` and `Size (sizeGroupId, sortOrder)` are unique ("sortOrder 0 = main color" must be unambiguous).

## Inventory (B안: reserve on order → allocate on payment → deduct on shipment / release / expire)

- Tables: `InventoryLocation` (ONLINE_DC is the only `isOnlineSellable`), `InventoryBalance` (sku × location: `onHand`, `reserved`, `safetyStock`), `InventoryLedger` (append-only; signed `qty` by type; `balanceAfter`), `InventoryReservation` (one per `orderItemId`; RESERVED (20-min TTL) → ALLOCATED on payment (never expires) → CONFIRMED on shipment (`shipmentId`); RESERVED → RELEASED(+reason) | EXPIRED; ALLOCATED → RELEASED only after the refund is done (no live payment)). `Sku` has no stock column.
- **Stock leaves the ledger when goods leave the warehouse** (⑦): paying only allocates; shipping a `Shipment` turns its reservations CONFIRMED → SALE ledger (`occurredAt` = shippedAt). A cancel before shipment just releases the allocation (no ledger rows), so onHand always equals the shelf.
- **The app never writes balance numbers.** Insert ledger rows / insert or update reservations; triggers keep `onHand = SUM(ledger)` and `reserved = SUM(RESERVED + ALLOCATED)`, reject reservations above `onHand − reserved − safetyStock`, and turn CONFIRMED into a SALE ledger row. Balance rows can only be created with zeros (`ensureBalance`); use `recordMovement()` for inbound/adjustments (adjust/defect/manual need a reason).
- `lib/inventory.ts`: `getAvailability` (display; ignores expired-but-unreleased reservations), `reserveOrder`, `releaseOrder`, `releaseExpired`, `ensureOrderReserved` (before Toss confirm: re-reserves expired or <2 min reservations as RENEWED; if stock is gone, Toss is never called), `allocateOrder` (on payment), `releaseAllocated` (after a full refund), `withBusyRetry` (SQLite `SQLITE_BUSY`/P1008 after ~5 s when two connections write → retry, so the loser gets "재고 부족" instead of an error).
- `lib/checkout.ts`: `placeOrder` (validates, prices, cancels the customer's previous PENDING orders (SUPERSEDED) **except ones with a payment IN_PROGRESS/UNKNOWN**, creates order + reservations in one transaction). Everything after order creation is `lib/payment.ts` (re-exported).
- `ensureReservedTx(tx, orderId, now, { minRemainingMs, expiresAt })` re-reserves when needed; `reserveOrder(..., expiresAt)` takes a custom expiry (virtual accounts hold stock until due date + 1 h). Reservations can only be inserted for PENDING/WAITING_DEPOSIT orders.

## Customer (B안: login account User ≠ shop customer Customer)

- `User`/`Account`/`Session` belong to Auth.js. `Customer` (1:1 via nullable unique `userId`) is the shop customer; **`Order.customerId` → Customer** (not User), so orders survive withdrawal. Always resolve the logged-in customer with `getCurrentCustomer()` (`lib/current-customer.ts`) — never `session.user.id` for shop data. `lib/customer.ts` must not import `@/auth` (auth.ts imports it → cycle).
- Sign-up = first login: `auth.ts` events.signIn → `ensureCustomerForUser` (customer + empty profile + grade history; status history is written by trigger) + `recordLogin`. callbacks.signIn blocks SUSPENDED customers and re-joins within 30 days of withdrawal (`rejoinBlockHash` = HMAC of provider:providerAccountId) → `/login-blocked`.
- PII (`CustomerProfile`, `CustomerAddress`) is AES-256-GCM encrypted via `lib/crypto.ts` (`v1:iv:tag:ct`; keys `CUSTOMER_ENC_KEY`, `CUSTOMER_HASH_KEY` in .env — 32-byte base64, **required in every environment incl. Vercel; losing the key = losing the data**). Phone/email lookups use HMAC blind indexes (`phoneHash`, `emailHash`); show only masked values (`maskName`/`maskPhone`...). CHECKs reject plaintext in encrypted columns; login IPs must be masked.
- Status changes must also set `statusReason` + a new `statusChangedAt` (trigger enforces; another trigger writes `CustomerStatusHistory`). Allowed: ACTIVE↔DORMANT/SUSPENDED, →WITHDRAW_PENDING→(ACTIVE | WITHDRAWN). Grade changes require inserting `CustomerGradeHistory` first. Only ACTIVE customers can insert orders (trigger).
- Withdrawal: `requestWithdrawal` (blocked while a RESERVED reservation exists, money is open, or an item is PAID..DELIVERED — not yet confirmed) → 7-day grace (`cancelWithdrawal`) → `completeWithdrawal`/`processDueWithdrawals`: wipe profile PII, delete body profile + addresses, complete withdrawal + rejoin hash, set WITHDRAWN + userId null, then delete the User (Account/Session cascade). Customers are never deleted.
- Prisma `upsert` on SQLite fires BEFORE INSERT triggers even when it updates — insert triggers must exclude the row's own key.
- Jobs: `npm run customer:jobs -- withdrawals|dormant|grades|login-history|all` (cron after deploy). Pages: `/my` (profile masked, body, addresses, grade), `/my/withdraw`, `/login-blocked`. Tests: `tests/customer.test.ts` (temp DB), `tests/crypto.test.ts`. `tests/helpers/temp-db.ts` loads .env first.

## Payment (B안: one Payment row per attempt, lib/payment.ts)

- Tables: `Payment` (an attempt; IN_PROGRESS → DONE | WAITING_FOR_DEPOSIT | ABORTED | EXPIRED | UNKNOWN, then PARTIAL_CANCELED/CANCELED through cancels), `PaymentCard`/`PaymentEasyPay`/`PaymentVirtualAccount` (1:1 details; card number masked only, VA account number encrypted), `PaymentCancel` (REQUESTED → DONE | FAILED | UNKNOWN), `PaymentRefundAccount` (encrypted, wiped after the refund), `PaymentStatusHistory` (trigger-written), `PaymentApiLog` (every Toss call, masked, kept 1 year), `PaymentWebhookEvent` (unique `dedupKey`), `CashReceipt`. `Order.status` is the enum `OrderStatus` (PENDING, WAITING_DEPOSIT, PAID, CANCELED, EXPIRED, CANCEL_FAILED) with `paidAt`/`canceledAt`.
- **Principles**: (1) persist the money fact (Payment DONE) first, then finalize order + inventory; if that fails, cancel the payment (compensation; if the cancel fails too → order CANCEL_FAILED for a human). (2) A timeout, network error or 5xx is **UNKNOWN, never failure**: ask Toss (`GET /v1/payments/{paymentKey}`), and if Toss still says IN_PROGRESS within 10 min, re-confirm with the **same Idempotency-Key**. (3) Never trust webhook bodies: re-fetch from Toss and apply that.
- **Concurrency**: inserting the IN_PROGRESS Payment is the lock. Trigger `Payment_insert_guard` allows one live payment per order; the losing request waits (`waitForOtherMs`) and returns the winner's result.
- **The app never writes payment amounts.** Insert/update `PaymentCancel`; triggers check the remaining amount (pending cancels count, so two concurrent cancels can't exceed it) and, when a cancel becomes DONE, recompute `canceledAmount`/`balanceAmount`/status. An `Order` becomes PAID only with a DONE payment of the same amount and every item ALLOCATED (no RESERVED); it can't be CANCELED/EXPIRED while a live payment exists. Orders and payments are never deleted.
- `lib/toss.ts`: `createTossApi({ transport })` (logs every call via `maskForLog`; results ok | fail | unknown), `getTossConfigProblem()`. `lib/payment.ts`: `confirmOrderPayment` (→ PAID | WAITING_DEPOSIT | PROCESSING | FAILED + code), `applyTossPayment` (Toss → our rows), `settleOrder`, `recordCheckoutFailure` (failUrl; **Toss sends no orderId for PAY_PROCESS_CANCELED/ABORTED** → uses the customer's latest PENDING order), `requestPaymentCancel`, `cancelWaitingDepositOrder`, `receiveWebhook`/`processWebhookEvent`, jobs `reconcileOpenPayments`, `expireOverdueDeposits` (Toss sends no webhook when a VA expires), `retryOpenCancels`, `retryWebhooks`, `closeStalePendingOrders`, `purgeOldApiLogs`. Deps (`toss`, `now`, `finalizeOrder`) are injectable for tests.
- Toss dates: payment times carry `+09:00`; VA `dueDate` and webhook `createdAt` have **no zone → parse as KST** (`parseTossDate`).
- Routes: `/api/payments/confirm` (no session → `loginPath(<the same confirm URL>)`, so payment continues after re-login), `/api/payments/fail`, `/api/payments/status` (polled by the pending page), `/api/payments/webhook` (register `https://<domain>/api/payments/webhook` in the Toss dashboard; localhost can't receive webhooks). Pages: `/checkout/fail?code=` (message picked by code from `lib/payment-labels.ts`, never taken from the URL), `/checkout/pending?orderNo=`, `/checkout/complete?orderNo=` (PAID, or WAITING_DEPOSIT showing the account to pay into), `/orders` (hides never-paid attempts). URLs carry the customer-facing `orderNo`, never the internal id; another customer's order answers exactly like a missing one (404).
- **Toss stores error responses under the Idempotency-Key too** (verified against the real test API): re-sending a confirm/cancel with the same key after a 5xx returns the same 5xx forever. So: no response (timeout/network) → retry with the same key; a 5xx response → query Toss first, then retry with a new key `<key>-rN` (`confirmKeyFor`/`cancelKeyFor`). A cancel is retried only after a successful Toss query shows it wasn't applied (otherwise it could refund twice).
- Checkout requires a shipping address (chosen from the address book; `placeOrder` snapshots it). `next.config.ts` sets `Cross-Origin-Opener-Policy: same-origin-allow-popups` (Toss recommendation against popup blocking).
- **Real end-to-end testing**: the docs keys complete payments only via 퀵계좌이체 (Toss demo: test phone prefilled, PIN `000000`); card windows are the real card-company pages. Force Toss errors with env `TOSS_TEST_CODE_CONFIRM` / `TOSS_TEST_CODE_CANCEL` (e.g. `INVALID_REJECT_CARD`, `FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING`) → sent as header `TossPayments-Test-Code`, only with `test_` keys (Toss ignores it in live).
- **The docs test keys (`test_gck_docs_…`) cannot test virtual accounts** and can't query payments by orderId. VA behavior is covered by fake-Toss tests; real VA testing needs the merchant's own test keys.

## Order (⑦ B안: order + per-item status + shipments, lib/order.ts)

- Two statuses, never mixed: `Order.status` = money (payment domain), `OrderItem.status` = goods (AWAITING_PAYMENT → PAID → PREPARING → SHIPPED → DELIVERED → CONFIRMED / CANCELED). `Order.fulfillmentStatus` is a trigger-computed summary (PARTIALLY_SHIPPED etc.) — never write it.
- Tables: `OrderShippingAddress` (1:1 snapshot, encrypted incl. delivery memo; `version` +1 per change, trigger copies the old one to `OrderShippingAddressHistory`), `OrderStatusHistory`/`OrderItemStatusHistory` (trigger-written from `statusChangedAt/By/Memo` — always use `orderStatusData`/`itemStatusData` from `lib/order-rules.ts`), `ShippingPolicy` (periods can't overlap; used ones are frozen) + `ShippingSurchargeZone` (Jeju/remote zip ranges), `Courier`, `Shipment` (1 box = 1 tracking no.) + `ShipmentItem` (one live box per item line).
- Money: `totalPrice = itemsTotal − coupon + shippingFee − shippingDiscount − pointUsed` (CHECK); per line `payAmount = lineTotal − couponAllocated − pointAllocated` (refund basis for ⑩); `Payment_order_ready` checks line sums + address before any payment starts. Base fee 3,000 free from 50,000 (before coupons); Jeju/remote surcharge always applies. `Order_shipping_rule` enforces the policy valid at `createdAt`.
- Cascades (triggers): order PAID → items PAID; order CANCELED/EXPIRED → items CANCELED; shipment SHIPPED → items SHIPPED + reservations CONFIRMED (SALE); shipment DELIVERED → items DELIVERED + `autoConfirmAt` = +7 days (`AUTO_CONFIRM_DAYS` in both lib and db-constraints).
- Rules: customer cancel only while all items are PAID (`cancelPaidOrder`; VA needs a refund account); PREPARING blocks customer cancel + address change (DB too); after shipment no full cancel (returns = ⑩); address change only to a zip with the same surcharge; per-item cancel is ⑩. Admin: `prepareOrder`, `registerShipment`, `shipShipment`, `deliverShipment`, `cancelShipment`, `adminCancelOrder`. Jobs: `autoConfirmDeliveredItems`, `purgeExpiredOrderPii` (5 years; only then can the DB wipe orderer/address ciphertexts).
- `orderNo` = KST date + 8 random digits (unique; never sequential). Pages: `/orders/[orderNo]` (items, tracking link, confirm, cancel, address change). Action errors go through a one-time flash cookie bound to `?e=<id>` — never put message text in the URL.
- Orders created before ⑦ use policy `LEGACY-FREE` and have no address snapshot.

## Restock & returns (재고 보강 2안: lib/purchasing.ts, lib/restock.ts, lib/returns.ts, lib/notification.ts)

- Purchasing: `PurchaseOrder` (DRAFT → ORDERED → CONFIRMED (every line has `expectedAt`, KST midnight) → PARTIALLY_RECEIVED → RECEIVED; CANCELED only before any receipt) + `PurchaseOrderLine` (`qtyReceived` is trigger-maintained from receipts) + `PurchaseOrderEvent` (append-only). `InboundReceipt`/`InboundReceiptLine`: good qty → INBOUND at the warehouse, defect qty → INBOUND at the DEFECT location (ledger rows carry `inboundLineId`); over-receipt is rejected.
- Restock date = earliest `expectedAt` of CONFIRMED/PARTIALLY_RECEIVED lines not fully received (`restockDates`, computed, never stored). `RestockSubscription` (members, sold-out SKUs only, one open per SKU, 90 days): `syncRestock(skuId)` notifies scheduled / rescheduled / canceled / arrived (dedupKey per subscription+date) — call it after PO confirm/date change/cancel/receive and return restock; `inventory:jobs -- restock` catches stock freed by order cancels. Paying for the SKU after "arrived" marks PURCHASED.
- `Notification` = in-site inbox (`/my/notifications`, header badge) + future EMAIL/KAKAO queue; unique `dedupKey`, content immutable, `linkUrl` same-site only. Admin notifications have `customerId` null.
- Low stock: `InventoryBalance.reorderPoint/reorderQty`; `checkLowStock` opens one `StockAlert` + admin notification when available ≤ point and no open PO; resolves on restock / PO / threshold change. Customer "품절 임박" uses `LOW_STOCK_DISPLAY` (`lib/cart-rules.ts`).
- Returns: `ReturnRequest` (REQUESTED → APPROVED → COLLECTING (pickup courier+tracking) → RECEIVED → INSPECTED → COMPLETED; REJECTED/CANCELED) + `ReturnItem` (whole line qty, one active return per item). Window: customer fault (단순 변심·사이즈) 7 days, seller fault (불량·오배송·파손) 30 days after delivery; CONFIRMED items can't be returned; auto-confirm skips items in return. Item statuses RETURN_REQUESTED → RETURN_COLLECTING → RETURNED (or back to DELIVERED on reject/withdraw/NOT_RETURNABLE).
- **Return stock follows the physical item**: arrival = RETURN_IN at RETURN_CENTER (not sellable); inspection RESELLABLE = TRANSFER to the warehouse (sellable again → restock alerts), DEFECTIVE = TRANSFER to DEFECT (still refunded), NOT_RETURNABLE = RETURN_REJECT_OUT (sent back, no refund). Trigger `InventoryLedger_return_guard` enforces this order. Reservations of returned items stay CONFIRMED (they did ship).
- Refund (`computeReturnRefund`): accepted items' `payAmount` − return fee. Customer fault fee = one-way (policy base fee + Jeju/remote surcharge) + the original one-way leg if this return pushes a free-shipping order below the threshold (count this return's items as still kept "before" — they may already be RETURNED when computing). Seller fault: no fee; if nothing is kept, the original shipping fee is refunded too. Refund = Toss partial cancel (`requestedBy: SYSTEM`, `requestedByRef` = returnNo); on 5xx/no answer the return stays INSPECTED and `inventory:jobs -- return-refunds` resolves open cancels first, then completes.
- Migration note: adding enum values needs the table rebuilt. Prisma uses `ALTER TABLE ADD COLUMN` for a new nullable column, which keeps the old enum CHECK — rebuild such tables by hand (Order, OrderItem, OrderItemStatusHistory were rebuilt in `20261118150000`); `db:verify` reports stale CHECKs.

## Coupons (⑬ B안: lib/coupon.ts server, lib/coupon-rules.ts pure/client-safe)

- Tables: `CouponPolicy` (DRAFT → ACTIVE ↔ PAUSED → ENDED; rules frozen once not DRAFT; `issuedCount` trigger-maintained) + `CouponPolicyTarget` (same matching as promotions: EXCLUDE wins, CATEGORY includes descendants) + `CouponPolicyGrade` (none = everyone) + `CouponCode` (shared code, uppercase) + `CouponCodeAttempt` (10 wrong / hour → locked) → `CustomerCoupon` (one issued coupon; `validFrom/validTo` copied at issue; `issueKey` dedups periodic issues) + `CustomerCouponHistory` (trigger-written) → `OrderCoupon` (RESERVED → APPLIED | RELEASED; APPLIED → CANCELED) + `OrderItemCoupon` (per-line split; sum = `OrderItem.couponAllocated`).
- **One coupon per order, any kind (no stacking)** — user decision; `OrderCoupon_one_per_order` rejects a 2nd OrderCoupon on an order. Kinds: PRODUCT (applied to the eligible line with the largest discount; base = lineTotal), ORDER (base = eligible lines' lineTotal; split by `allocate()` largest-remainder, rows for every eligible line incl. 0원), SHIPPING (base fee only, never the Jeju/remote surcharge). RATE 1–90% floored to 10원 + max cap; AMOUNT must be < base (no 0원 lines). Free-shipping threshold uses the pre-coupon itemsTotal.
- **The app never writes coupon statuses.** `Order` status change → trigger `Order_coupon_cascade` moves OrderCoupons (PAID → APPLIED; CANCELED/EXPIRED without payment → RELEASED; CANCELED after payment → CANCELED) → `OrderCoupon_after_status` moves the CustomerCoupon (USED, or back to AVAILABLE if `validTo` > event time else EXPIRED). Inserting an OrderCoupon sets IN_USE. So every cancel/expire/supersede path restores coupons automatically. Partial returns don't restore (refund = `payAmount`, already net of the split). A customer-fault full return keeps the order PAID (fee kept) → coupon not restored.
- Issue rules are enforced by `CustomerCoupon_issue_guard` (policy ACTIVE, issue window, total quantity, per-customer limit, ACTIVE customer, grade, method, code, validity = fixed period or "issue day incl. N days" ending KST midnight — `couponValidTo()` and the trigger's `validToDaysSql` must stay identical).
- Use rules: `OrderCoupon_insert_guard` (PENDING member order, own AVAILABLE coupon, order `createdAt` inside validity, policy ACTIVE/ENDED, one ORDER/SHIPPING per order, amount caps), `OrderItemCoupon_insert_guard` (same order, eligibility in SQL incl. `applyToSaleItems`, one PRODUCT coupon per line, min amount), `Payment_coupon_ready` (sums/splits/min/rate checked before any payment starts). `confirmOrderPayment` aborts with `COUPON_UNAVAILABLE` before calling Toss if a used policy was PAUSED after ordering.
- Checkout: the page sends `couponOptionsFor()` (eligible SKU ids computed on the server) → `CheckoutView` lists `couponChoices()` as radio buttons sorted by discount desc (ties → earlier `validTo`; unusable ones last with a reason) with expiry shown; a coupon blocked only because its policy excludes on-sale items (`applyToSaleItems=false`) says so via `CouponOption.saleExcludedSkuIds`. **No auto-selection** (default "쿠폰 사용 안 함"; user decision: customers choose considering expiry) → `createOrder(items, addressId, couponId)` → `placeOrder({ couponId })` recomputes with `applyCoupon()` from DB data. Days-left uses the server's `nowMs` prop (no `Date.now()` during render — lint `react-hooks/purity`). `usableCoupons()` also returns coupons held by the customer's own supersedable PENDING order (the re-order releases them first in the same transaction).
- Issue flows: sign-up (`ensureCustomerForUser` → `issueSignupCoupons`, failures never block login), download (`/products/[code]` box, `/my/coupons`), code (`/my/coupons`, checkout), jobs (birthday by KST month, `BIRTHDAY:yyyy`; grade monthly `GRADE:yyyymm`), admin (`coupons:ops -- issue`). Withdrawal revokes AVAILABLE coupons (trigger `Customer_coupon_revoke`). Guests can't use coupons (CHECK).
- Results go to pages as `?coupon=<CouponNoticeCode>`; text comes from `COUPON_NOTICE`, never from the URL. Tests: `tests/coupon-rules.test.ts` (pure), `tests/coupon.test.ts` (temp DB; ends by running `db-verify` on the scenario DB). New members now also get a COUPON_ISSUED notification — filter notifications by type in tests.

## Guest orders (비회원, lib/guest.ts)

- `Order.ordererType` (MEMBER | GUEST) is the identity **at purchase time** and never changes. `customerId` is null for a guest order until a member claims it (`linkedAt`). Guests: orderer name/phone/email required (encrypted), coupon/point/shipping discount = 0 (CHECKs).
- Owner checks go through `OrderOwner` (`lib/order-rules.ts`): `{ customerId }` (login) or `{ guestOrderId }` (pass). A plain number still means a member id. Resolve the request's owner with `lib/current-owner.ts` (`getOwners`, `getGuestOrderId`); never trust a client-sent id.
- Tables: `GuestOrderAccess` (scrypt hash `s1:salt:hash`, failedCount/lockedUntil, privacy consent time+version, claimedAt/By), `GuestOrderSession` (pass = random token in httpOnly cookie `shop-guest-order`, SHA-256 in DB; CHECKOUT 60 min / LOOKUP 30 min; revoke-only), `GuestLookupAttempt` (append-only, ipHash HMAC + masked IP, 90 days).
- Lookup (`/guest/orders`): 5 wrong → 30-min lock; 20 failures/hour per IP → blocked. "No such order / wrong / locked" all answer WRONG (no existence leak); CLAIMED is shown only when the password matches.
- Checkout: `/login` → "비회원으로 주문하기" → `/checkout?guest=1` (members always get member checkout). `placeGuestOrder` creates order + access + CHECKOUT pass; Toss gets `customerKey: ANONYMOUS`. `/api/payments/confirm` accepts a guest only if the pass belongs to that order (else `GUEST_SESSION_EXPIRED`, nothing charged).
- Claim (`/orders/claim`, `claimGuestOrder`): member proves ownership with order no. + password or a valid pass from the same browser; **never auto-link by phone/email** (sign-up has no phone/email verification). Claiming sets `customerId`/`linkedAt` once (trigger `Order_link_guard` + `GuestOrderAccess_update_guard`), revokes passes; counts toward grades, no retroactive coupons/points. Pending orders and non-ACTIVE members can't claim.
- Jobs: `npm run orders:jobs -- guest-cleanup`. The 5-year PII purge also wipes the guest password hash.

## Architecture

- **Data flow**: pages under `src/app` are async server components that query Prisma directly. Every page that reads the DB sets `export const dynamic = "force-dynamic"` so that DB changes show up without a rebuild.
- **Cart lives only in the browser**:
  - `src/context/CartContext.tsx` stores `{ skuId: number, quantity }[]` in localStorage under the key `my-shop-cart-v3`. It reads the cart through `useSyncExternalStore` (a module-level store with a cached snapshot and a cross-tab `storage` listener), not `useEffect`. Keep that pattern when changing it.
  - `CartProvider` wraps everything in `src/app/layout.tsx`, and components access the cart with `useCart()`.
  - The server does not know what is in the cart. So `app/cart/page.tsx` (server) loads SKUs via `getCartSkus()` (`lib/catalog.ts`, flattens style/color/size into `CartSku`) and passes them to `components/CartView.tsx` (client), which joins cart items to SKUs.
- **Schema** (`prisma/schema.prisma`):
  - **Product domain (B안, 3 levels)**: `Style` (one detail page, URL `/products/[code]` = `styleCode`) → `StyleColor` (per-color images/status, `sortOrder` 0 = main color, `?color=BK` selects) → `Sku` (color × size; cart/order unit; `stock` is temporary until the inventory step). Masters: `Season`, `Category` (tree: `parentId` + `path` `/1/4/`, gender-neutral; gender is `Style.gender`), `Color` (`code`, `hex`, `family`), `SizeGroup`/`Size` (`sortOrder`). Masters also: `Material` (StyleMaterial.materialId — never free text), `Manufacturer`, `CareSymbol`. Details: `StyleColorImage`, `StyleMaterial`, `SizeMeasurement`, `ModelWear`, `StyleNotice` (JSON `[{label,value}]`), `StyleCare` (N:M), `StyleWearSeason` (N:M to enum), `StyleDetailBlock` (TEXT/IMAGE/VIDEO blocks by sortOrder). `Style.maxQtyPerOrder` is a per-order limit summed across all SKUs of the style — enforced by `findQtyLimitViolation()` in `lib/cart-rules.ts` (client-safe, shared by CartView and `createOrder`); `preorderShipDate`, `metaTitle`/`metaDescription` (used in `generateMetadata`).
  - **Price domain (C안)**: no price columns on `Style`. List price = `StylePrice` row with `validFrom <= now < validTo` (null = current; SCD Type 2, future rows allowed). Sale price is **computed, never stored**, by `getPrices(styleIds, now?)` in `lib/pricing.ts`: active `PricePromotion` (`status APPROVED` + `startAt <= now < endAt`) whose `PricePromotionTarget`s match (ALL/CATEGORY via `category.path` incl. descendants/SEASON/GENDER/STYLE; any EXCLUDE wins; most specific INCLUDE's `discountValueOverride`), RATE/AMOUNT/FIXED_PRICE → `roundingUnit`/`roundingMode` → `maxDiscountAmount`; the single largest discount wins (tie → `priority`). Do money math in integers (`list * (100 - n) / 100`, not `list * 0.7`). Styles without a current `StylePrice` are unsellable (excluded from list, 404, `CartSku.sellable=false`). `getCartSkus()` fills `listPrice/price/discountAmount/promotionId/promotionName`; `createOrder` snapshots them into `OrderItem`.
  - Pricing never sells at ≤ 0원: a promotion whose result would be < 1원 is treated as not applicable. Money math is integer-only.
  - Dates: seed parses date-only strings as KST via `kst()` (`new Date("2026-09-01")` is UTC = 09:00 KST). Display dates only through `formatDate`/`formatDateTime` in `lib/format.ts` (fixed `Asia/Seoul`; server TZ on Vercel is UTC).
  - Checkout aborts if the server-computed amount differs from the amount shown (a promotion started/ended in between) and releases that order's reservation via `cancelPendingOrder`.
  - Seed promotions are created relative to seed time (running / scheduled / ended / DRAFT / PAUSED) so behavior is visible whenever you seed; to re-seed pricing, delete `PricePromotion` rows first.
  - "Sold out" is never a status; it is derived from SKU stock. Sellable = `sellableStyleWhere()` / `sellableColorWhere` / `isStyleSellable()` in `lib/catalog.ts` (status ON_SALE + isDisplayed + not soft-deleted + sale window). Display labels for enums live in `lib/product-labels.ts` (client-safe).
  - Images are placeholder SVGs from `/api/placeholder?bg=&icon=&text=` stored as `StyleColorImage.url`; swap for real URLs later. `<img>` is used with an eslint-disable for `@next/next/no-img-element`.
  - `Order` (`status` enum `OrderStatus`, see Payment) has many `OrderItem` and many `Payment`.
  - `OrderItem` references `skuId` (and optional `promotionId`, SetNull) and snapshots `listPrice`, `discountAmount`, `price`, `promotionName`, `styleCode`, `skuCode`, `styleName`, `colorName`, `sizeName`, `imageUrl` at order time; order pages read these snapshots, not the live product. Order totals are always calculated on the server from DB prices, never from amounts the client sends.
- **Payment flow** (Toss Payments widget SDK v2, public docs test keys in `.env`: `NEXT_PUBLIC_TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY`): cart → `/checkout` (login required; shows a config error instead of the widget when `getTossConfigProblem()` finds empty/mismatched keys; `CheckoutView` renders the widget once, a ref guards StrictMode) → server action `createOrder` (server-computed amount, PENDING order, random `paymentOrderId`) → `widgets.setAmount(serverAmount)` + `requestPayment` → Toss redirects to `/api/payments/confirm` or `/api/payments/fail`. Details in `## Payment`.
- **Auth** (`src/auth.ts`):
  - Auth.js v5 (`next-auth@5.0.0-beta.32`, pinned) with the Prisma adapter and **database sessions**. The cookie `authjs.session-token` maps to a `Session` row.
  - Env vars in `.env`: `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`. The GitHub OAuth App callback is `http://localhost:3000/api/auth/callback/github`.
  - Under `next start` (not dev, not Vercel), you must set `AUTH_TRUST_HOST=true`, or Auth.js throws UntrustedHost.
  - **Login page `/login`** (`pages.signIn`) with a "로그인 상태 유지" checkbox (unchecked by default). Its server action (`app/login/actions.ts`) sets `shop-login-remember` (15 min) and, when unchecked, `shop-browser-session` (no expiry → removed when the browser closes), then `signIn("github")`. The adapter is wrapped by `withLoginPolicy` (`lib/auth-session.ts`): checked → Auth.js default (30 days, extended on use); unchecked or missing choice → `Session.absoluteExpiresAt` = login + 12 h (never extended) and `browserKeyHash` = SHA-256 of the browser cookie; a missing/different browser cookie or passing 12 h deletes the session (logged out). Closing a single tab does not log out. Redirect to the login page with `loginPath(returnTo)` (`lib/safe-redirect.ts`, same-site paths only), not `/api/auth/signin`. Sign-out also deletes `shop-browser-session`.
  - Server components call `auth()`. The `session` callback adds `session.user.id`.
  - When filtering by user, check that the id is defined first. A Prisma `where: { userId: undefined }` means no filter.
  - To test logged-in pages without GitHub, insert `User` + `Session` rows (and call `ensureCustomerForUser`) and send the cookie `authjs.session-token=<token>`. Customers can't be deleted, so rebuild dev.db afterwards.
- `src/lib/format.ts`: `formatPrice()` turns a price into a KRW string, e.g. `19,000원`.
