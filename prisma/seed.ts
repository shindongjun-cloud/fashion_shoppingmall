// 데이터베이스에 처음 넣을 샘플 데이터 (`npm run db:seed`로 실행)
// 상품 도메인 B안: 마스터(시즌·카테고리·컬러·사이즈) → 스타일 → 컬러 → SKU 순서로 넣습니다.
// (부모가 먼저 있어야 자식이 부모 id를 가리킬 수 있기 때문)
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import type {
  Prisma,
  PriceChangeReason,
  CareCategory,
  Fit,
  Gender,
  ImageType,
  Level3,
  Lining,
  ManufacturerRole,
  MaterialKind,
  MeasureItem,
  NoticeType,
  WearSeason,
} from "../src/generated/prisma/client";

// ---------------------------------------------------------------
// 1) 마스터 데이터
// ---------------------------------------------------------------
const seasons = [
  { code: "26SS", name: "2026 봄/여름", year: 2026, term: "SS" as const, sortOrder: 1 },
  { code: "26FW", name: "2026 가을/겨울", year: 2026, term: "FW" as const, sortOrder: 2 },
];

// 카테고리 트리: [대분류, 고시 품목군, 중분류들]
const categoryTree: {
  code: string;
  name: string;
  noticeType: NoticeType;
  children: { code: string; name: string }[];
}[] = [
  {
    code: "OUTER", name: "아우터", noticeType: "CLOTHING",
    children: [
      { code: "OUTER_JACKET", name: "자켓" },
      { code: "OUTER_COAT", name: "코트" },
    ],
  },
  {
    code: "TOP", name: "상의", noticeType: "CLOTHING",
    children: [
      { code: "TOP_SHIRT", name: "셔츠" },
      { code: "TOP_KNIT", name: "니트" },
      { code: "TOP_TEE", name: "티셔츠" },
    ],
  },
  {
    code: "BOTTOM", name: "하의", noticeType: "CLOTHING",
    children: [
      { code: "BOTTOM_PANTS", name: "팬츠" },
      { code: "BOTTOM_DENIM", name: "데님" },
    ],
  },
  {
    code: "SHOES", name: "신발", noticeType: "SHOES",
    children: [{ code: "SHOES_SNEAKERS", name: "스니커즈" }],
  },
  {
    code: "ACC", name: "액세서리", noticeType: "ACCESSORY",
    children: [{ code: "ACC_CAP", name: "모자" }],
  },
];

const colors = [
  { code: "BK", name: "블랙", nameEn: "BLACK", hex: "#1A1A1A", family: "BLACK" as const },
  { code: "CH", name: "차콜", nameEn: "CHARCOAL", hex: "#3E4247", family: "GRAY" as const },
  { code: "GY", name: "그레이", nameEn: "GRAY", hex: "#9A9DA1", family: "GRAY" as const },
  { code: "WH", name: "화이트", nameEn: "WHITE", hex: "#F7F7F5", family: "WHITE" as const },
  { code: "IV", name: "아이보리", nameEn: "IVORY", hex: "#EFE8D8", family: "WHITE" as const },
  { code: "BE", name: "베이지", nameEn: "BEIGE", hex: "#C8B79A", family: "BEIGE" as const },
  { code: "NV", name: "네이비", nameEn: "NAVY", hex: "#1F2A44", family: "NAVY" as const },
  { code: "SB", name: "스카이블루", nameEn: "SKY BLUE", hex: "#A9C6E8", family: "BLUE" as const },
  { code: "KH", name: "카키", nameEn: "KHAKI", hex: "#6B6B47", family: "GREEN" as const },
];

const sizeGroups = [
  { code: "TOP_KR", name: "상의 (95~110)", sizes: [["95", "95 (M)"], ["100", "100 (L)"], ["105", "105 (XL)"], ["110", "110 (XXL)"]] },
  { code: "TOP_ALPHA", name: "상의 (S~L)", sizes: [["S", "S"], ["M", "M"], ["L", "L"]] },
  { code: "BOTTOM_INCH", name: "하의 (28~34인치)", sizes: [["28", "28"], ["30", "30"], ["32", "32"], ["34", "34"]] },
  { code: "SHOES_MM", name: "신발 (240~280mm)", sizes: [["240", "240"], ["250", "250"], ["260", "260"], ["270", "270"], ["280", "280"]] },
  { code: "FREE", name: "FREE", sizes: [["F", "FREE"]] },
];

const materials: { code: string; name: string; nameEn: string; kind: MaterialKind }[] = [
  { code: "WOOL", name: "울", nameEn: "Wool", kind: "NATURAL" },
  { code: "LAMBSWOOL", name: "램스울", nameEn: "Lambswool", kind: "NATURAL" },
  { code: "COTTON", name: "면", nameEn: "Cotton", kind: "NATURAL" },
  { code: "POLYESTER", name: "폴리에스터", nameEn: "Polyester", kind: "SYNTHETIC" },
  { code: "POLYURETHANE", name: "폴리우레탄", nameEn: "Polyurethane", kind: "SYNTHETIC" },
  { code: "RAYON", name: "레이온", nameEn: "Rayon", kind: "REGENERATED" },
  { code: "COWHIDE", name: "소가죽", nameEn: "Cowhide", kind: "LEATHER" },
  { code: "RUBBER", name: "고무", nameEn: "Rubber", kind: "OTHER" },
];

const manufacturers: { code: string; name: string; role: ManufacturerRole; country: string; contactPhone: string }[] = [
  { code: "MYSHOP", name: "(주)마이샵", role: "MANUFACTURER", country: "대한민국", contactPhone: "1588-0000" },
  { code: "HANBIT", name: "한빛어패럴(주)", role: "MANUFACTURER", country: "대한민국", contactPhone: "02-000-0000" },
  { code: "GLOBALKNIT", name: "(주)글로벌니트코리아", role: "IMPORTER", country: "대한민국", contactPhone: "02-111-1111" },
];

// 세탁 기호. icon은 임시 표시용 짧은 글자입니다 (나중에 KS 세탁기호 이미지로 교체)
const careSymbols: { code: string; category: CareCategory; name: string; icon: string }[] = [
  { code: "MACHINE_WASH_30", category: "WASH", name: "30℃ 세탁기 약하게", icon: "30°" },
  { code: "HAND_WASH_30", category: "WASH", name: "30℃ 손세탁", icon: "✋" },
  { code: "NO_WASH", category: "WASH", name: "물세탁 금지", icon: "✕水" },
  { code: "NO_BLEACH", category: "BLEACH", name: "표백 금지", icon: "✕△" },
  { code: "NO_TUMBLE_DRY", category: "DRY", name: "건조기 금지", icon: "✕◎" },
  { code: "DRY_FLAT", category: "DRY", name: "뉘어서 그늘 건조", icon: "▭" },
  { code: "IRON_LOW", category: "IRON", name: "110℃ 이하 다림질", icon: "•" },
  { code: "IRON_MID", category: "IRON", name: "150℃ 이하 다림질", icon: "••" },
  { code: "NO_IRON", category: "IRON", name: "다림질 금지", icon: "✕" },
  { code: "DRYCLEAN", category: "DRYCLEAN", name: "드라이클리닝", icon: "Ⓟ" },
  { code: "NO_DRYCLEAN", category: "DRYCLEAN", name: "드라이클리닝 금지", icon: "✕Ⓟ" },
];

// ---------------------------------------------------------------
// 2) 스타일 데이터
// ---------------------------------------------------------------
type StyleSeed = {
  styleCode: string;
  name: string;
  summary: string;
  description: string;
  gender: Gender;
  category: string; // 카테고리 code
  season: string; // 시즌 code
  sizeGroup: string; // 사이즈 체계 code
  icon: string; // 이미지 대체 아이콘
  listPrice: number; // 현재 정가 → StylePrice로 들어갑니다 (판매가는 할인 행사로 계산)
  fit?: Fit;
  thickness?: Level3;
  stretch?: Level3;
  sheerness?: Level3;
  lining?: Lining;
  releasedAt: string;
  // 컬러 코드 → 사이즈별 재고 (사이즈 순서대로)
  colors: { code: string; label?: string; stock: number[] }[];
  materials: [part: string, materialCode: string, percent: number][];
  manufacturer: string; // 제조사 code
  cares: string[]; // 세탁 기호 code
  wearSeasons: WearSeason[];
  point: string; // 상세 콘텐츠 블록의 "디자인 포인트" 본문
  maxQtyPerOrder?: number;
  // 실측: 항목 → 사이즈별 cm (사이즈 순서대로)
  measurements: Partial<Record<MeasureItem, number[]>>;
  model?: { color: string; size: string; heightCm: number; weightKg: number; note: string };
  notice: { type: NoticeType; madeIn: string; care: string };
};

const styles: StyleSeed[] = [
  {
    styleCode: "JK26F001",
    name: "울 블렌드 싱글 자켓",
    summary: "울 70% 블렌드의 클래식 싱글 브레스티드 자켓",
    description:
      "탄탄한 울 블렌드 원단으로 형태감을 살린 싱글 브레스티드 자켓입니다. 어깨에 패드를 최소화해 자연스러운 실루엣을 만들었고, 슬랙스나 데님 어디에나 잘 어울립니다.",
    gender: "MEN", category: "OUTER_JACKET", season: "26FW", sizeGroup: "TOP_KR", icon: "🧥",
    listPrice: 259000,
    fit: "REGULAR", thickness: "MEDIUM", stretch: "LOW", sheerness: "LOW", lining: "FULL",
    releasedAt: "2026-11-10",
    colors: [
      { code: "BK", label: "딥 블랙", stock: [5, 12, 8, 3] },
      { code: "BE", stock: [4, 7, 0, 2] }, // 베이지 105 품절
    ],
    materials: [["겉감", "WOOL", 70], ["겉감", "POLYESTER", 30], ["안감", "POLYESTER", 100]],
    manufacturer: "HANBIT",
    cares: ["NO_WASH", "NO_BLEACH", "IRON_LOW", "DRYCLEAN"],
    wearSeasons: ["SPRING", "FALL"],
    point: "어깨 패드를 얇게 넣어 각이 지지 않고 자연스럽게 떨어집니다. 노치드 라펠과 투 버튼 여밈의 기본에 충실한 디자인으로, 셔츠는 물론 니트 위에도 잘 어울립니다.",
    measurements: {
      SHOULDER: [45, 46.5, 48, 49.5],
      CHEST: [54, 56.5, 59, 61.5],
      SLEEVE: [62, 63, 64, 65],
      LENGTH: [73, 75, 77, 79],
    },
    model: { color: "BK", size: "100", heightCm: 183, weightKg: 72, note: "평소 100 착용, 정사이즈 추천" },
    notice: { type: "CLOTHING", madeIn: "대한민국", care: "드라이클리닝 전용" },
  },
  {
    styleCode: "SH26S002",
    name: "옥스포드 버튼다운 셔츠",
    summary: "매일 입기 좋은 코튼 옥스포드 셔츠",
    description:
      "도톰한 코튼 옥스포드 원단에 버튼다운 칼라를 더한 기본 셔츠입니다. 단독으로도, 니트나 자켓 안에 레이어드해도 좋습니다.",
    gender: "UNISEX", category: "TOP_SHIRT", season: "26SS", sizeGroup: "TOP_ALPHA", icon: "👔",
    listPrice: 79000,
    fit: "RELAXED", thickness: "MEDIUM", stretch: "LOW", sheerness: "LOW", lining: "NONE",
    releasedAt: "2026-03-02",
    colors: [
      { code: "WH", stock: [10, 15, 9] },
      { code: "SB", stock: [6, 0, 4] },
      { code: "NV", stock: [3, 5, 2] },
    ],
    materials: [["겉감", "COTTON", 100]],
    manufacturer: "MYSHOP",
    cares: ["MACHINE_WASH_30", "NO_BLEACH", "IRON_MID"],
    wearSeasons: ["SPRING", "SUMMER", "FALL"],
    point: "버튼다운 칼라가 칼라 모양을 잡아 줘서 타이 없이 입어도 단정합니다. 뒷면 박스 플리츠로 활동성을 높였습니다.",
    measurements: {
      SHOULDER: [47, 49, 51],
      CHEST: [57, 60, 63],
      SLEEVE: [60, 61.5, 63],
      LENGTH: [74, 76, 78],
    },
    model: { color: "WH", size: "L", heightCm: 181, weightKg: 70, note: "여유 있는 핏으로 L 착용" },
    notice: { type: "CLOTHING", madeIn: "베트남", care: "30℃ 이하 단독 손세탁, 표백제 사용 금지" },
  },
  {
    styleCode: "KN26F003",
    name: "램스울 크루넥 니트",
    summary: "부드러운 램스울 100% 크루넥",
    description:
      "가볍고 보온성이 좋은 램스울 100%로 짠 크루넥 니트입니다. 몸에 붙지 않는 적당한 품으로 셔츠 위에 겹쳐 입기 좋습니다.",
    gender: "WOMEN", category: "TOP_KNIT", season: "26FW", sizeGroup: "TOP_ALPHA", icon: "🧶",
    listPrice: 129000,
    fit: "REGULAR", thickness: "MEDIUM", stretch: "MEDIUM", sheerness: "LOW", lining: "NONE",
    releasedAt: "2026-10-20",
    colors: [
      { code: "IV", stock: [8, 6, 4] },
      { code: "CH", stock: [0, 0, 0] }, // 차콜 전 사이즈 품절
      { code: "BE", stock: [2, 5, 3] },
    ],
    materials: [["겉감", "LAMBSWOOL", 100]],
    manufacturer: "GLOBALKNIT",
    cares: ["HAND_WASH_30", "NO_BLEACH", "NO_TUMBLE_DRY", "DRY_FLAT", "DRYCLEAN"],
    wearSeasons: ["FALL", "WINTER"],
    point: "12게이지로 촘촘하게 짜서 가볍지만 따뜻합니다. 밑단과 소매 끝의 립 조직이 실루엣을 깔끔하게 잡아 줍니다.",
    measurements: {
      SHOULDER: [40, 42, 44],
      CHEST: [48, 51, 54],
      SLEEVE: [57, 58, 59],
      LENGTH: [60, 62, 64],
    },
    model: { color: "IV", size: "S", heightCm: 170, weightKg: 50, note: "평소 S 착용" },
    notice: { type: "CLOTHING", madeIn: "중국", care: "드라이클리닝 권장, 손세탁 시 울 전용 세제 사용" },
  },
  {
    styleCode: "PT26F004",
    name: "원턱 와이드 슬랙스",
    summary: "허리 원턱 주름으로 여유를 준 와이드 슬랙스",
    description:
      "허리에 원턱 주름을 넣어 허벅지부터 밑단까지 여유 있게 떨어지는 와이드 슬랙스입니다. 뒷허리 밴딩으로 편하게 입을 수 있습니다.",
    gender: "MEN", category: "BOTTOM_PANTS", season: "26FW", sizeGroup: "BOTTOM_INCH", icon: "👖",
    listPrice: 89000,
    fit: "RELAXED", thickness: "MEDIUM", stretch: "MEDIUM", sheerness: "LOW", lining: "NONE",
    releasedAt: "2026-09-15",
    colors: [
      { code: "BK", stock: [7, 10, 6, 2] },
      { code: "GY", stock: [3, 4, 4, 1] },
    ],
    materials: [["겉감", "POLYESTER", 65], ["겉감", "RAYON", 32], ["겉감", "POLYURETHANE", 3]],
    manufacturer: "HANBIT",
    cares: ["HAND_WASH_30", "NO_BLEACH", "IRON_LOW", "DRYCLEAN"],
    wearSeasons: ["SPRING", "FALL", "WINTER"],
    point: "원턱 주름이 허벅지 부분에 여유를 만들고, 밑단으로 갈수록 곧게 떨어집니다. 뒷허리 밴딩으로 앉았을 때도 편안합니다.",
    measurements: {
      WAIST: [37, 39.5, 42, 44.5],
      HIP: [52, 54.5, 57, 59.5],
      THIGH: [33, 34.5, 36, 37.5],
      RISE: [30, 31, 32, 33],
      HEM: [24, 25, 26, 27],
      LENGTH: [102, 103, 104, 105],
    },
    model: { color: "BK", size: "30", heightCm: 183, weightKg: 72, note: "평소 30 착용" },
    notice: { type: "CLOTHING", madeIn: "대한민국", care: "중성세제 손세탁 또는 드라이클리닝" },
  },
  {
    styleCode: "SN26S005",
    name: "레더 코트 스니커즈",
    summary: "천연 소가죽 미니멀 코트 스니커즈",
    description:
      "부드러운 소가죽 어퍼에 쿠션 인솔을 넣은 미니멀 코트 스니커즈입니다. 정사이즈로 제작되었으며 발볼이 넓다면 반 사이즈 업을 추천합니다.",
    gender: "UNISEX", category: "SHOES_SNEAKERS", season: "26SS", sizeGroup: "SHOES_MM", icon: "👟",
    listPrice: 169000,
    releasedAt: "2026-04-01",
    colors: [
      { code: "WH", stock: [4, 8, 10, 6, 3] },
      { code: "BK", stock: [2, 5, 0, 4, 1] },
    ],
    materials: [["갑피", "COWHIDE", 100], ["밑창", "RUBBER", 100]],
    manufacturer: "GLOBALKNIT",
    cares: ["NO_WASH", "NO_BLEACH"],
    wearSeasons: ["SPRING", "SUMMER", "FALL", "WINTER"],
    point: "한 장의 가죽으로 재단한 매끈한 어퍼에 쿠션 인솔을 넣었습니다. 한정 생산 상품이라 1회 주문 시 2켤레까지 구매할 수 있습니다.",
    maxQtyPerOrder: 2,
    measurements: {},
    notice: { type: "SHOES", madeIn: "베트남", care: "가죽 전용 클리너 사용" },
  },
  {
    styleCode: "CP26S006",
    name: "코튼 로고 볼캡",
    summary: "워싱 코튼 6패널 볼캡",
    description:
      "워싱 가공한 코튼 트윌로 만든 6패널 볼캡입니다. 뒤쪽 스트랩으로 머리둘레를 조절할 수 있습니다.",
    gender: "UNISEX", category: "ACC_CAP", season: "26SS", sizeGroup: "FREE", icon: "🧢",
    listPrice: 45000,
    releasedAt: "2026-05-10",
    colors: [
      { code: "BK", stock: [20] },
      { code: "NV", stock: [11] },
      { code: "BE", stock: [0] },
    ],
    materials: [["겉감", "COTTON", 100]],
    manufacturer: "MYSHOP",
    cares: ["HAND_WASH_30", "NO_BLEACH", "NO_TUMBLE_DRY"],
    wearSeasons: ["SPRING", "SUMMER", "FALL", "WINTER"],
    point: "워싱 가공으로 처음부터 부드럽고 자연스러운 빈티지 느낌이 납니다. 챙 곡선을 미리 잡아 두어 바로 쓰기 좋습니다.",
    measurements: { HEAD: [58], BRIM: [7], DEPTH: [13] },
    notice: { type: "ACCESSORY", madeIn: "중국", care: "손세탁, 건조기 사용 금지" },
  },
];

// 이미지 파일이 아직 없어서, 컬러 색으로 칠한 임시 이미지 주소를 만듭니다.
// (/api/placeholder 가 SVG 그림을 그려줌. 나중에 실제 CDN 주소로 바꾸면 끝)
const imageShots: { type: ImageType; label: string }[] = [
  { type: "MAIN", label: "FRONT" },
  { type: "BACK", label: "BACK" },
  { type: "MODEL", label: "MODEL" },
  { type: "DETAIL", label: "DETAIL" },
];
// "2026-09-01" 같은 날짜만 있는 문자열을 한국 시각 0시로 바꿉니다.
// ⚠️ new Date("2026-09-01")은 UTC 0시 = 한국 오전 9시라서, 가격 변경이 9시간 늦게 적용되는 버그가 생깁니다.
function kst(date: string) {
  return new Date(`${date}T00:00:00+09:00`);
}

function placeholderUrl(hex: string, icon: string, text: string) {
  const params = new URLSearchParams({ bg: hex.replace("#", ""), icon, text });
  return `/api/placeholder?${params.toString()}`;
}

// ---------------------------------------------------------------
// 3) 실행
// ---------------------------------------------------------------
async function seedProducts() {
  const count = await prisma.style.count();
  if (count > 0) {
    console.log(`이미 스타일 ${count}개가 있어서 건너뜁니다.`);
    return;
  }

  // 트랜잭션: 중간에 실패하면 전부 취소 (반쯤 들어간 데이터가 남지 않게)
  await prisma.$transaction(async (tx) => {
    // 시즌
    const seasonIds = new Map<string, number>();
    for (const s of seasons) {
      const row = await tx.season.create({ data: s });
      seasonIds.set(s.code, row.id);
    }

    // 카테고리 트리: 부모를 먼저 만들어야 자식이 부모 id를 가리킬 수 있습니다.
    // path("/1/4/")와 depth는 넣지 않습니다. DB 트리거(Category_path_fill)가 부모를 보고 자동으로 계산합니다.
    const categoryIds = new Map<string, number>();
    for (const [i, root] of categoryTree.entries()) {
      const parent = await tx.category.create({
        data: { code: root.code, name: root.name, noticeType: root.noticeType, sortOrder: i },
      });
      categoryIds.set(root.code, parent.id);
      for (const [j, child] of root.children.entries()) {
        const row = await tx.category.create({
          data: { code: child.code, name: child.name, noticeType: root.noticeType, parentId: parent.id, sortOrder: j },
        });
        categoryIds.set(child.code, row.id);
      }
    }

    // 컬러
    const colorRows = new Map<string, { id: number; name: string; nameEn: string; hex: string }>();
    for (const [i, c] of colors.entries()) {
      const row = await tx.color.create({ data: { ...c, sortOrder: i } });
      colorRows.set(c.code, row);
    }

    // 사이즈 체계 + 사이즈
    const sizeGroupIds = new Map<string, number>();
    const sizeIds = new Map<string, number[]>(); // 그룹 code → 순서대로 사이즈 id
    const sizeIdByCode = new Map<string, number>(); // "TOP_KR:100" → id
    for (const g of sizeGroups) {
      const group = await tx.sizeGroup.create({ data: { code: g.code, name: g.name } });
      sizeGroupIds.set(g.code, group.id);
      const ids: number[] = [];
      for (const [i, [code, label]] of g.sizes.entries()) {
        const size = await tx.size.create({
          data: { sizeGroupId: group.id, code, label, sortOrder: i },
        });
        ids.push(size.id);
        sizeIdByCode.set(`${g.code}:${code}`, size.id);
      }
      sizeIds.set(g.code, ids);
    }

    // 소재 / 제조사 / 세탁 기호 마스터
    const materialRows = new Map<string, { id: number; name: string }>();
    for (const [i, m] of materials.entries()) {
      materialRows.set(m.code, await tx.material.create({ data: { ...m, sortOrder: i } }));
    }
    const manufacturerRows = new Map<string, { id: number; name: string; role: ManufacturerRole }>();
    for (const m of manufacturers) {
      manufacturerRows.set(m.code, await tx.manufacturer.create({ data: m }));
    }
    const careRows = new Map<string, { id: number; name: string }>();
    for (const [i, c] of careSymbols.entries()) {
      careRows.set(c.code, await tx.careSymbol.create({ data: { ...c, sortOrder: i } }));
    }

    // 스타일 → 컬러 → SKU / 이미지 → 혼용률·실측·모델·세탁·계절·상세블록·고시
    for (const s of styles) {
      const groupSizeIds = sizeIds.get(s.sizeGroup)!;
      const groupSizes = sizeGroups.find((g) => g.code === s.sizeGroup)!.sizes;

      const style = await tx.style.create({
        data: {
          styleCode: s.styleCode,
          name: s.name,
          summary: s.summary,
          description: s.description,
          gender: s.gender,
          categoryId: categoryIds.get(s.category)!,
          seasonId: seasonIds.get(s.season)!,
          sizeGroupId: sizeGroupIds.get(s.sizeGroup)!,
          manufacturerId: manufacturerRows.get(s.manufacturer)!.id,
          maxQtyPerOrder: s.maxQtyPerOrder,
          metaTitle: `${s.name} | 마이샵 공식몰`,
          metaDescription: s.summary,
          fit: s.fit,
          thickness: s.thickness,
          stretch: s.stretch,
          sheerness: s.sheerness,
          lining: s.lining,
          // 처음부터 ON_SALE로 등록할 수 없습니다(DB 트리거 Style_sale_ready_ins).
          // DRAFT로 등록 → 컬러·SKU·이미지·고시·정가를 채운 뒤 openSales()에서 판매 시작
          status: "DRAFT",
          isDisplayed: true,
          releasedAt: kst(s.releasedAt),
        },
      });

      const styleColorIds = new Map<string, number>();
      for (const [ci, c] of s.colors.entries()) {
        const color = colorRows.get(c.code)!;
        const styleColor = await tx.styleColor.create({
          data: {
            styleId: style.id,
            colorId: color.id,
            code: `${s.styleCode}-${c.code}`,
            colorLabel: c.label,
            sortOrder: ci, // 0번이 대표 컬러
          },
        });
        styleColorIds.set(c.code, styleColor.id);

        // SKU: 컬러 × 사이즈
        await tx.sku.createMany({
          data: groupSizeIds.map((sizeId, si) => ({
            styleColorId: styleColor.id,
            sizeId,
            skuCode: `${s.styleCode}-${c.code}-${groupSizes[si][0]}`,
            barcode: `880${String(style.id).padStart(3, "0")}${String(ci).padStart(2, "0")}${String(si).padStart(2, "0")}`,
            stock: c.stock[si] ?? 0,
          })),
        });

        // 컬러별 이미지 4장
        await tx.styleColorImage.createMany({
          data: imageShots.map((shot, i) => ({
            styleColorId: styleColor.id,
            url: placeholderUrl(color.hex, s.icon, `${color.nameEn} · ${shot.label}`),
            type: shot.type,
            alt: `${s.name} ${color.name} ${shot.label}`,
            sortOrder: i,
          })),
        });
      }

      // 혼용률
      await tx.styleMaterial.createMany({
        data: s.materials.map(([part, code, percent], i) => ({
          styleId: style.id, part, materialId: materialRows.get(code)!.id, percent, sortOrder: i,
        })),
      });

      // 세탁 기호 (N:M)
      await tx.styleCare.createMany({
        data: s.cares.map((code, i) => ({
          styleId: style.id, careSymbolId: careRows.get(code)!.id, sortOrder: i,
        })),
      });

      // 착용 계절 (N:M)
      await tx.styleWearSeason.createMany({
        data: s.wearSeasons.map((season) => ({ styleId: style.id, season })),
      });

      // 상세 콘텐츠 블록: 이미지 → 텍스트 → 이미지 → 텍스트 순서로 쌓습니다.
      const mainColor = colorRows.get(s.colors[0].code)!;
      await tx.styleDetailBlock.createMany({
        data: [
          { type: "IMAGE" as const, mediaUrl: placeholderUrl(mainColor.hex, s.icon, "EDITORIAL"), alt: `${s.name} 화보`, body: `${s.name} — ${s.season} 컬렉션` },
          { type: "TEXT" as const, title: "디자인 포인트", body: s.point },
          { type: "IMAGE" as const, mediaUrl: placeholderUrl(mainColor.hex, s.icon, "DETAIL CLOSE-UP"), alt: `${s.name} 디테일`, body: "디테일 클로즈업" },
          { type: "TEXT" as const, title: "사이즈 팁", body: s.model?.note ?? "정사이즈로 제작되었습니다." },
        ].map((block, i) => ({ ...block, styleId: style.id, sortOrder: i })),
      });

      // 실측
      await tx.sizeMeasurement.createMany({
        data: Object.entries(s.measurements).flatMap(([item, values]) =>
          values!.map((valueCm, si) => ({
            styleId: style.id,
            sizeId: groupSizeIds[si],
            item: item as MeasureItem,
            valueCm,
          })),
        ),
      });

      // 모델 착용 정보
      if (s.model) {
        await tx.modelWear.create({
          data: {
            styleId: style.id,
            styleColorId: styleColorIds.get(s.model.color),
            sizeId: sizeIdByCode.get(`${s.sizeGroup}:${s.model.size}`)!,
            heightCm: s.model.heightCm,
            weightKg: s.model.weightKg,
            note: s.model.note,
          },
        });
      }

      // 상품정보제공고시 (의류 품목군 기준 항목)
      const materialText = s.materials.map(([p, code, pct]) => `${p} ${materialRows.get(code)!.name} ${pct}%`).join(", ");
      const maker = manufacturerRows.get(s.manufacturer)!;
      const careText = s.cares.map((code) => careRows.get(code)!.name).join(", ");
      const colorText = s.colors.map((c) => colorRows.get(c.code)!.name).join(", ");
      const sizeText = groupSizes.map(([, label]) => label).join(", ");
      await tx.styleNotice.create({
        data: {
          styleId: style.id,
          noticeType: s.notice.type,
          content: [
            { label: s.notice.type === "SHOES" ? "제품 주소재" : "제품 소재", value: materialText },
            { label: "색상", value: colorText },
            { label: "치수", value: sizeText },
            { label: "제조자(수입자)", value: `${maker.name} (${maker.role === "IMPORTER" ? "수입자" : "제조자"})` },
            { label: "제조국", value: s.notice.madeIn },
            { label: "취급 시 주의사항", value: `${careText}. ${s.notice.care}` },
            { label: "제조연월", value: s.releasedAt.slice(0, 7) },
            { label: "품질보증기준", value: "관련 법 및 소비자분쟁해결기준에 따름" },
            { label: "A/S 책임자와 전화번호", value: "마이샵 고객센터 1588-0000" },
          ],
        },
      });
    }
  });

  const [styleCount, colorCount, skuCount] = await Promise.all([
    prisma.style.count(),
    prisma.styleColor.count(),
    prisma.sku.count(),
  ]);
  console.log(`스타일 ${styleCount}개, 컬러 ${colorCount}개, SKU ${skuCount}개를 추가했습니다.`);
}

// ---------------------------------------------------------------
// 4) 가격: 정가 이력 + 할인 행사
// ---------------------------------------------------------------
const DAY = 24 * 60 * 60 * 1000;

type PriceRow = { listPrice: number; from: Date; to?: Date; reason: PriceChangeReason; memo: string };

// 정가 이력 (SCD Type 2). to가 없으면 현재 가격
// 셔츠: 원가 인상으로 정가가 바뀐 이력 / 자켓: 미래에 바뀔 가격을 미리 등록해 둔 예
function priceHistoryFor(styleCode: string, listPrice: number, releasedAt: string, now: Date): PriceRow[] {
  if (styleCode === "SH26S002") {
    return [
      { listPrice: 75000, from: kst(releasedAt), to: kst("2026-09-01"), reason: "INITIAL", memo: "최초 출시 가격" },
      { listPrice, from: kst("2026-09-01"), reason: "COST_CHANGE", memo: "옥스포드 원단 단가 6% 인상 반영" },
    ];
  }
  if (styleCode === "JK26F001") {
    const repriceAt = new Date(now.getTime() + 45 * DAY);
    return [
      { listPrice, from: kst(releasedAt), to: repriceAt, reason: "INITIAL", memo: "최초 출시 가격" },
      { listPrice: 269000, from: repriceAt, reason: "REPRICE", memo: "27SS 가격 재책정 (미리 예약 등록)" },
    ];
  }
  return [{ listPrice, from: kst(releasedAt), reason: "INITIAL", memo: "최초 출시 가격" }];
}

async function seedPricing() {
  const count = await prisma.pricePromotion.count();
  if (count > 0) {
    console.log(`이미 할인 행사 ${count}개가 있어서 가격 데이터는 건너뜁니다.`);
    return;
  }

  // 행사 기간은 "seed를 실행한 시각" 기준으로 잡습니다.
  // (고정 날짜로 넣으면 며칠 뒤에는 전부 끝난 행사가 되어 동작을 확인할 수 없음)
  const now = new Date();
  const at = (days: number) => new Date(now.getTime() + days * DAY);

  await prisma.$transaction(async (tx) => {
    const styleRows = await tx.style.findMany({ select: { id: true, styleCode: true } });
    const styleId = (code: string) => styleRows.find((r) => r.styleCode === code)!.id;
    const categoryId = async (code: string) => (await tx.category.findUniqueOrThrow({ where: { code } })).id;
    const seasonId = async (code: string) => (await tx.season.findUniqueOrThrow({ where: { code } })).id;

    // 정가 이력: 샘플 기준으로 다시 만듭니다.
    // (마이그레이션이 기존 정가를 1행씩 복사해 두었는데, 이를 이력이 있는 샘플로 교체)
    await tx.stylePrice.deleteMany();
    for (const s of styles) {
      for (const row of priceHistoryFor(s.styleCode, s.listPrice, s.releasedAt, now)) {
        await tx.stylePrice.create({
          data: {
            styleId: styleId(s.styleCode),
            listPrice: row.listPrice,
            validFrom: row.from,
            validTo: row.to ?? null,
            reason: row.reason,
            memo: row.memo,
            changedBy: "seed",
          },
        });
      }
    }

    // 할인 행사: 진행 중 / 예정 / 종료 / 작성 중 / 일시 중지를 모두 만들어 동작을 확인합니다.
    const promotions: Prisma.PricePromotionCreateInput[] = [
      {
        code: "SS26_SEASON_OFF", name: "26SS 시즌오프", displayName: "시즌오프",
        description: "26SS 전 품목 40%, 상품당 최대 3만원. 스니커즈는 베스트셀러라 제외",
        discountType: "RATE", discountValue: 40, maxDiscountAmount: 30000,
        startAt: at(-7), endAt: at(30), status: "APPROVED", priority: 10,
        badgeText: "SEASON OFF", approvedBy: "seed", approvedAt: at(-8),
        targets: { create: [
          { targetType: "SEASON", mode: "INCLUDE", season: { connect: { id: await seasonId("26SS") } } },
          { targetType: "STYLE", mode: "EXCLUDE", style: { connect: { id: styleId("SN26S005") } } },
        ] },
      },
      {
        code: "KNIT_WEEK_2611", name: "11월 니트 위크", displayName: "니트 위크",
        discountType: "RATE", discountValue: 20,
        startAt: at(-2), endAt: at(5), status: "APPROVED", priority: 5,
        badgeText: "KNIT WEEK", showEndDate: true, approvedBy: "seed", approvedAt: at(-3),
        targets: { create: [
          { targetType: "CATEGORY", mode: "INCLUDE", category: { connect: { id: await categoryId("TOP_KNIT") } } },
        ] },
      },
      {
        code: "TOP_DAILY_2611", name: "상의 데일리 특가", displayName: "데일리 특가",
        description: "상의 전체 10%. 다른 행사와 겹치면 할인이 더 큰 쪽이 적용됨",
        discountType: "RATE", discountValue: 10,
        startAt: at(-3), endAt: at(10), status: "APPROVED", priority: 1,
        approvedBy: "seed", approvedAt: at(-4),
        targets: { create: [
          { targetType: "CATEGORY", mode: "INCLUDE", category: { connect: { id: await categoryId("TOP") } } },
        ] },
      },
      {
        code: "SNEAKERS_139", name: "레더 스니커즈 균일가", displayName: "스니커즈 특가",
        discountType: "FIXED_PRICE", discountValue: 139000, roundingUnit: 1000,
        startAt: at(-1), endAt: at(3), status: "APPROVED", priority: 5,
        badgeText: "SPECIAL PRICE", showEndDate: true, approvedBy: "seed", approvedAt: at(-2),
        targets: { create: [
          { targetType: "STYLE", mode: "INCLUDE", style: { connect: { id: styleId("SN26S005") } } },
        ] },
      },
      {
        code: "BLACK_FRIDAY_2026", name: "2026 블랙프라이데이", displayName: "블랙프라이데이",
        description: "전체 30%(최대 5만원), 아우터는 35%. 신상 자켓은 제외. 예정된 행사",
        discountType: "RATE", discountValue: 30, maxDiscountAmount: 50000,
        startAt: at(8), endAt: at(14), status: "APPROVED", priority: 20,
        badgeText: "BLACK FRIDAY", showEndDate: true, approvedBy: "seed", approvedAt: at(-1),
        targets: { create: [
          { targetType: "ALL", mode: "INCLUDE" },
          { targetType: "CATEGORY", mode: "INCLUDE", category: { connect: { id: await categoryId("OUTER") } }, discountValueOverride: 35 },
          { targetType: "STYLE", mode: "EXCLUDE", style: { connect: { id: styleId("JK26F001") } } },
        ] },
      },
      {
        code: "FW_OUTER_PREVIEW", name: "가을 아우터 프리뷰", displayName: "아우터 프리뷰",
        description: "이미 끝난 행사 (기간 종료)",
        discountType: "AMOUNT", discountValue: 20000,
        startAt: at(-30), endAt: at(-10), status: "APPROVED",
        approvedBy: "seed", approvedAt: at(-31),
        targets: { create: [
          { targetType: "CATEGORY", mode: "INCLUDE", category: { connect: { id: await categoryId("OUTER") } } },
        ] },
      },
      {
        code: "YEAR_END_2026", name: "연말 감사제 (기획 중)", displayName: "연말 감사제",
        description: "작성 중이라 적용되지 않음",
        discountType: "RATE", discountValue: 15,
        startAt: at(30), endAt: at(40), status: "DRAFT",
        targets: { create: [{ targetType: "ALL", mode: "INCLUDE" }] },
      },
      {
        code: "PANTS_50_ERROR", name: "슬랙스 50% (가격 오류로 중지)", displayName: "슬랙스 특가",
        description: "50%로 잘못 등록되어 긴급 일시 중지. 기간 안이지만 적용되지 않음",
        discountType: "RATE", discountValue: 50,
        startAt: at(-1), endAt: at(5), status: "PAUSED",
        approvedBy: "seed", approvedAt: at(-1),
        targets: { create: [
          { targetType: "STYLE", mode: "INCLUDE", style: { connect: { id: styleId("PT26F004") } } },
        ] },
      },
    ];
    for (const data of promotions) {
      await tx.pricePromotion.create({ data: { ...data, createdBy: "seed" } });
    }
  });

  const [priceCount, promoCount] = await Promise.all([
    prisma.stylePrice.count(),
    prisma.pricePromotion.count(),
  ]);
  console.log(`정가 이력 ${priceCount}행, 할인 행사 ${promoCount}개를 추가했습니다.`);
}

// 상품을 먼저 넣고, 가격(정가 이력·행사)을 이어서 넣습니다.
// 각각 "이미 있으면 건너뛰기"라서 여러 번 실행해도 중복되지 않습니다.
// 판매 시작: DRAFT → ON_SALE
// 이 순간 DB 트리거(Style_sale_ready_upd)가 정가·고시·판매 컬러·SKU·대표 이미지·혼용률 합계를 검사합니다.
// 하나라도 빠지면 어떤 정보가 없는지 알려 주며 거부합니다.
async function openSales() {
  const opened = await prisma.style.updateMany({
    where: { status: "DRAFT", styleCode: { in: styles.map((s) => s.styleCode) } },
    data: { status: "ON_SALE" },
  });
  if (opened.count > 0) console.log(`스타일 ${opened.count}개 판매를 시작했습니다.`);
}

async function main() {
  await seedProducts();
  await seedPricing(); // 정가가 있어야 판매를 시작할 수 있으므로 가격이 먼저
  await openSales();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
