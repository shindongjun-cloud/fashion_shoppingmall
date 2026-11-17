// 데이터베이스에 처음 넣을 상품 데이터 (`npm run db:seed`로 실행)
// 1단계에서 src/data/products.ts에 있던 상품들을 옮겨왔습니다.
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const products = [
  {
    name: "베이직 코튼 티셔츠",
    price: 19000,
    category: "의류",
    emoji: "👕",
    color: "bg-sky-100",
    description: "매일 입기 좋은 부드러운 면 100% 티셔츠입니다.",
  },
  {
    name: "데일리 청바지",
    price: 49000,
    category: "의류",
    emoji: "👖",
    color: "bg-indigo-100",
    description: "어디에나 잘 어울리는 스트레이트 핏 청바지입니다.",
  },
  {
    name: "러닝 스니커즈",
    price: 89000,
    category: "신발",
    emoji: "👟",
    color: "bg-emerald-100",
    description: "가볍고 쿠션감이 좋은 러닝화입니다.",
  },
  {
    name: "캔버스 에코백",
    price: 25000,
    category: "가방",
    emoji: "👜",
    color: "bg-amber-100",
    description: "노트북도 들어가는 넉넉한 사이즈의 에코백입니다.",
  },
  {
    name: "볼캡 모자",
    price: 22000,
    category: "잡화",
    emoji: "🧢",
    color: "bg-rose-100",
    description: "햇빛을 가려주는 기본 볼캡입니다.",
  },
  {
    name: "선글라스",
    price: 39000,
    category: "잡화",
    emoji: "🕶️",
    color: "bg-violet-100",
    description: "자외선 차단 렌즈를 사용한 선글라스입니다.",
  },
];

async function main() {
  // 이미 상품이 있으면 중복으로 넣지 않습니다.
  const count = await prisma.product.count();
  if (count > 0) {
    console.log(`이미 상품 ${count}개가 있어서 건너뜁니다.`);
    return;
  }

  await prisma.product.createMany({ data: products });
  console.log(`상품 ${products.length}개를 추가했습니다.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
