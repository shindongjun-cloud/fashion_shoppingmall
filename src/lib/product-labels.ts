// DB에는 영어 코드(REGULAR, MEDIUM...)로 저장하고, 화면에는 한글로 보여줍니다.
// 이 파일은 DB를 쓰지 않아서 브라우저 코드(클라이언트 컴포넌트)에서도 가져다 쓸 수 있어요.
import type {
  Fit,
  Gender,
  Level3,
  Lining,
  MeasureItem,
  WearSeason,
} from "@/generated/prisma/enums";

export const GENDER_LABEL: Record<Gender, string> = {
  MEN: "남성",
  WOMEN: "여성",
  UNISEX: "공용",
};

// 핏/두께감 등은 "단계 중 어디인지"를 보여주려고 순서 배열도 같이 둡니다.
export const FIT_SCALE: { value: Fit; label: string }[] = [
  { value: "SLIM", label: "슬림" },
  { value: "REGULAR", label: "레귤러" },
  { value: "RELAXED", label: "릴렉스드" },
  { value: "OVERSIZED", label: "오버사이즈" },
];

const LEVELS: Level3[] = ["LOW", "MEDIUM", "HIGH"];
export const THICKNESS_SCALE = scale(LEVELS, ["얇음", "보통", "두꺼움"]);
export const STRETCH_SCALE = scale(LEVELS, ["없음", "약간", "좋음"]);
export const SHEERNESS_SCALE = scale(LEVELS, ["없음", "약간", "있음"]);
export const LINING_SCALE = scale<Lining>(["NONE", "PARTIAL", "FULL"], ["없음", "부분", "전체"]);

function scale<T extends string>(values: T[], labels: string[]) {
  return values.map((value, i) => ({ value, label: labels[i] }));
}

export const WEAR_SEASON_SCALE: { value: WearSeason; label: string }[] = [
  { value: "SPRING", label: "봄" },
  { value: "SUMMER", label: "여름" },
  { value: "FALL", label: "가을" },
  { value: "WINTER", label: "겨울" },
];

// 실측표 열 순서도 여기서 정합니다.
export const MEASURE_ITEMS: { value: MeasureItem; label: string }[] = [
  { value: "SHOULDER", label: "어깨너비" },
  { value: "CHEST", label: "가슴단면" },
  { value: "SLEEVE", label: "소매길이" },
  { value: "WAIST", label: "허리단면" },
  { value: "HIP", label: "엉덩이단면" },
  { value: "THIGH", label: "허벅지단면" },
  { value: "RISE", label: "밑위" },
  { value: "HEM", label: "밑단단면" },
  { value: "HEAD", label: "머리둘레" },
  { value: "BRIM", label: "챙길이" },
  { value: "DEPTH", label: "깊이" },
  { value: "LENGTH", label: "총장" },
];
