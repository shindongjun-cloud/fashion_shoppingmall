/* eslint-disable @next/next/no-img-element -- 임시 SVG 이미지라 next/image 최적화가 필요 없음 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDate, formatDateTime, formatPrice } from "@/lib/format";
import { sellableColorWhere, sellableStyleWhere } from "@/lib/catalog";
import {
  FIT_SCALE,
  GENDER_LABEL,
  LINING_SCALE,
  MEASURE_ITEMS,
  SHEERNESS_SCALE,
  STRETCH_SCALE,
  THICKNESS_SCALE,
  WEAR_SEASON_SCALE,
} from "@/lib/product-labels";
import SizeSelector from "@/components/SizeSelector";
import { getPrices } from "@/lib/pricing";
import { getAvailability } from "@/lib/inventory";
import { restockDates } from "@/lib/restock";
import { getCurrentCustomer } from "@/lib/current-customer";

export const dynamic = "force-dynamic";

// 검색엔진·공유 미리보기용 제목과 설명 (Style.metaTitle / metaDescription, 없으면 이름·한 줄 소개)
export async function generateMetadata({
  params,
}: PageProps<"/products/[code]">): Promise<Metadata> {
  const { code } = await params;
  const style = await prisma.style.findFirst({
    where: { styleCode: code, ...sellableStyleWhere() },
    select: { name: true, summary: true, metaTitle: true, metaDescription: true },
  });
  if (!style) return {};
  return {
    title: style.metaTitle ?? style.name,
    description: style.metaDescription ?? style.summary ?? undefined,
  };
}

// 상품 상세: /products/JK26F001?color=BE
// - [code] = 품번(styleCode). 상세페이지는 스타일 단위로 1개 (B안)
// - ?color= 로 선택한 컬러의 사진과 사이즈별 재고를 보여줍니다. 없으면 대표 컬러.
export default async function ProductPage({
  params,
  searchParams,
}: PageProps<"/products/[code]">) {
  const { code } = await params;
  const { color: colorParam, restock: restockParam } = await searchParams;

  const style = await prisma.style.findFirst({
    where: { styleCode: code, ...sellableStyleWhere() },
    include: {
      category: { include: { parent: true } },
      season: true,
      colors: {
        where: sellableColorWhere,
        orderBy: { sortOrder: "asc" },
        include: {
          color: true,
          images: { orderBy: { sortOrder: "asc" } },
          skus: { include: { size: true }, orderBy: { size: { sortOrder: "asc" } } },
        },
      },
      materials: { orderBy: { sortOrder: "asc" }, include: { material: true } },
      manufacturer: true,
      cares: { orderBy: { sortOrder: "asc" }, include: { careSymbol: true } },
      wearSeasons: true,
      detailBlocks: { where: { isVisible: true }, orderBy: { sortOrder: "asc" } },
      measurements: { include: { size: true } },
      modelWears: { include: { size: true, styleColor: { include: { color: true } } } },
      notice: true,
    },
  });

  if (!style || style.colors.length === 0) {
    notFound();
  }

  // 판매가 계산 (정가 + 지금 진행 중인 할인 행사). 정가가 없으면 팔 수 없는 상품
  const [prices, availability] = await Promise.all([
    getPrices([style.id]),
    getAvailability(style.colors.flatMap((c) => c.skus.map((k) => k.id))), // 판매 가능 수량 (실재고 − 예약 − 안전재고)
  ]);
  const price = prices.get(style.id);
  const available = (skuId: number) => availability.get(skuId) ?? 0;
  if (!price) {
    notFound();
  }

  // 주소의 ?color=BE 와 맞는 컬러를 고르고, 없으면 대표 컬러(0번)
  const selected =
    style.colors.find((c) => c.color.code === colorParam) ?? style.colors[0];
  // 품절 사이즈의 재입고 예정일 + 내 재입고 알림 신청 여부
  const selectedSkuIds = selected.skus.map((k) => k.id);
  const customer = await getCurrentCustomer();
  const [restock, mySubs] = await Promise.all([
    restockDates(selectedSkuIds),
    customer ? prisma.restockSubscription.findMany({ where: { customerId: customer.id, skuId: { in: selectedSkuIds }, status: { in: ["WAITING", "SCHEDULED"] } }, select: { skuId: true } }) : [],
  ]);
  const subscribedIds = new Set(mySubs.map((x) => x.skuId));
  const back = `/products/${style.styleCode}?color=${selected.color.code}`;
  const restockNotice = restockParam === "ok" ? "재입고 알림을 신청했어요. 일정이 정해지거나 입고되면 알림함으로 알려 드려요." : restockParam === "instock" ? "지금 구매할 수 있는 상품이에요. 사이즈를 다시 골라 주세요." : undefined;
  const rate = price.discountRate;

  // 실측표: 데이터가 있는 항목만 열로, 사이즈는 정렬 순서대로 행으로
  const measureColumns = MEASURE_ITEMS.filter((item) =>
    style.measurements.some((m) => m.item === item.value),
  );
  const measureSizes = [
    ...new Map(style.measurements.map((m) => [m.size.id, m.size])).values(),
  ].sort((a, b) => a.sortOrder - b.sortOrder);

  // 혼용률: 부위(part)별로 묶기 → "겉감: 울 70%, 폴리에스터 30%"
  const materialsByPart = new Map<string, string[]>();
  for (const m of style.materials) {
    materialsByPart.set(m.part, [
      ...(materialsByPart.get(m.part) ?? []),
      `${m.material.name} ${m.percent}%`,
    ]);
  }

  // 핏 정보: 값이 있는 속성만
  const fitRows = [
    { name: "핏", scale: FIT_SCALE, value: style.fit },
    { name: "두께감", scale: THICKNESS_SCALE, value: style.thickness },
    { name: "신축성", scale: STRETCH_SCALE, value: style.stretch },
    { name: "비침", scale: SHEERNESS_SCALE, value: style.sheerness },
    { name: "안감", scale: LINING_SCALE, value: style.lining },
  ].filter((row) => row.value !== null);

  const wearSeasons = new Set(style.wearSeasons.map((w) => w.season));

  const notice = (style.notice?.content ?? []) as { label: string; value: string }[];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <nav className="text-sm text-gray-500">
        <Link href="/" className="hover:underline">홈</Link>
        {style.category.parent && <> › {style.category.parent.name}</>} ›{" "}
        {style.category.name}
      </nav>

      <div className="mt-6 grid gap-10 md:grid-cols-[3fr_2fr]">
        {/* 왼쪽: 선택한 컬러의 이미지 (컬러를 바꾸면 이 영역이 바뀝니다) */}
        <div className="grid grid-cols-2 gap-2">
          {selected.images.map((img) => (
            <img
              key={img.id}
              src={img.url}
              alt={img.alt}
              className="aspect-[4/5] w-full rounded-lg object-cover"
            />
          ))}
        </div>

        {/* 오른쪽: 구매 정보 */}
        <div className="md:sticky md:top-6 md:self-start">
          <p className="text-sm text-gray-500">
            {GENDER_LABEL[style.gender]}
            {style.season && <> · {style.season.code}</>}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">{style.name}</h1>
          <p className="mt-1 text-xs text-gray-400">{style.styleCode}</p>

          <div className="mt-4 flex items-baseline gap-2">
            {rate > 0 && <span className="text-xl font-bold text-red-600">{rate}%</span>}
            <span className="text-2xl font-bold text-gray-900">
              {formatPrice(price.salePrice)}
            </span>
            {rate > 0 && (
              <span className="text-gray-400 line-through">{formatPrice(price.listPrice)}</span>
            )}
          </div>

          {/* 적용 중인 할인 행사 */}
          {price.promotion && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded bg-red-50 px-2 py-0.5 font-medium text-red-700">
                {price.promotion.displayName}
              </span>
              <span className="text-gray-600">{formatPrice(price.discountAmount)} 할인</span>
              {price.promotion.showEndDate && (
                <span className="text-gray-400">
                  ~{formatDateTime(price.promotion.endAt)} 종료
                </span>
              )}
            </p>
          )}

          {(style.preorderShipDate || style.maxQtyPerOrder) && (
            <ul className="mt-3 space-y-1 text-sm">
              {style.preorderShipDate && (
                <li className="text-blue-700">
                  예약 판매 · {formatDate(style.preorderShipDate)}부터 순차 출고
                </li>
              )}
              {style.maxQtyPerOrder && (
                <li className="text-gray-600">한정 수량 · 1회 주문 시 최대 {style.maxQtyPerOrder}개</li>
              )}
            </ul>
          )}

          {/* 컬러칩: 링크라서 서버가 그 컬러로 페이지를 다시 그립니다 */}
          <div className="mt-6">
            <p className="text-sm text-gray-700">
              컬러 <span className="font-medium text-gray-900">{selected.colorLabel ?? selected.color.name}</span>
            </p>
            <div className="mt-2 flex gap-2">
              {style.colors.map((c) => {
                const soldOut = !c.skus.some((s) => s.status === "ON_SALE" && available(s.id) > 0);
                const isSelected = c.id === selected.id;
                return (
                  <Link
                    key={c.id}
                    href={`/products/${style.styleCode}?color=${c.color.code}`}
                    replace
                    scroll={false}
                    title={`${c.colorLabel ?? c.color.name}${soldOut ? " (품절)" : ""}`}
                    className={`relative h-9 w-9 overflow-hidden rounded-full border-2 ${
                      isSelected ? "border-gray-900" : "border-gray-200"
                    }`}
                  >
                    <span
                      className="absolute inset-0.5 rounded-full"
                      style={{ backgroundColor: c.color.hex }}
                    />
                    {/* 품절 컬러는 사선 표시 */}
                    {soldOut && (
                      <span className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 rotate-45 bg-red-500" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* 사이즈 선택 + 장바구니 (브라우저에서 동작) */}
          <SizeSelector
            key={selected.id}
            skus={selected.skus.map((sku) => ({
              id: sku.id,
              sizeLabel: sku.size.label,
              stock: available(sku.id),
              onSale: sku.status === "ON_SALE",
              restockDate: restock.get(sku.id) ? formatDate(restock.get(sku.id)!) : null,
              subscribed: subscribedIds.has(sku.id),
            }))}
            back={back}
            loggedIn={Boolean(customer)}
            restockNotice={restockNotice}
          />

          {style.summary && <p className="mt-8 font-medium text-gray-900">{style.summary}</p>}
          <p className="mt-2 leading-relaxed text-gray-700">{style.description}</p>
        </div>
      </div>

      {/* 상세 콘텐츠 블록: 관리자가 쌓은 순서대로 텍스트·이미지·영상을 보여줍니다 */}
      {style.detailBlocks.length > 0 && (
        <section className="mx-auto mt-20 max-w-2xl space-y-10">
          {style.detailBlocks.map((block) => {
            if (block.type === "TEXT") {
              return (
                <div key={block.id} className="text-center">
                  {block.title && <h2 className="text-xl font-bold text-gray-900">{block.title}</h2>}
                  {block.body && <p className="mt-3 leading-relaxed text-gray-700">{block.body}</p>}
                </div>
              );
            }
            if (block.type === "IMAGE" && block.mediaUrl) {
              return (
                <figure key={block.id}>
                  <img src={block.mediaUrl} alt={block.alt ?? ""} className="w-full rounded-lg" />
                  {block.body && (
                    <figcaption className="mt-2 text-center text-sm text-gray-500">{block.body}</figcaption>
                  )}
                </figure>
              );
            }
            if (block.type === "VIDEO" && block.mediaUrl) {
              return <video key={block.id} src={block.mediaUrl} controls className="w-full rounded-lg" />;
            }
            return null;
          })}
        </section>
      )}

      {/* 아래쪽: 상세 정보 */}
      <div className="mt-16 grid gap-12 md:grid-cols-2">
        {(fitRows.length > 0 || wearSeasons.size > 0) && (
          <section>
            <h2 className="text-lg font-bold text-gray-900">핏 정보</h2>
            <dl className="mt-4 space-y-3">
              {fitRows.map((row) => (
                <div key={row.name} className="flex items-center gap-4">
                  <dt className="w-14 text-sm text-gray-500">{row.name}</dt>
                  <dd className="flex flex-1 gap-1">
                    {row.scale.map((step) => (
                      <span
                        key={step.value}
                        className={`flex-1 rounded py-1 text-center text-xs ${
                          step.value === row.value
                            ? "bg-gray-900 font-medium text-white"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {step.label}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
              {wearSeasons.size > 0 && (
                <div className="flex items-center gap-4">
                  <dt className="w-14 text-sm text-gray-500">계절감</dt>
                  <dd className="flex flex-1 gap-1">
                    {WEAR_SEASON_SCALE.map((step) => (
                      <span
                        key={step.value}
                        className={`flex-1 rounded py-1 text-center text-xs ${
                          wearSeasons.has(step.value)
                            ? "bg-gray-900 font-medium text-white"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {step.label}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        )}

        <section>
          <h2 className="text-lg font-bold text-gray-900">소재</h2>
          <dl className="mt-4 space-y-2 text-sm">
            {[...materialsByPart].map(([part, items]) => (
              <div key={part} className="flex gap-4">
                <dt className="w-14 text-gray-500">{part}</dt>
                <dd className="text-gray-900">{items.join(", ")}</dd>
              </div>
            ))}
          </dl>

          {style.cares.length > 0 && (
            <>
              <h3 className="mt-8 font-bold text-gray-900">세탁 방법</h3>
              <ul className="mt-3 flex flex-wrap gap-3">
                {style.cares.map(({ careSymbol }) => (
                  <li key={careSymbol.id} className="flex w-20 flex-col items-center gap-1 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full border border-gray-300 text-sm text-gray-800">
                      {careSymbol.icon}
                    </span>
                    <span className="text-xs text-gray-600">{careSymbol.name}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {style.manufacturer && (
            <p className="mt-6 text-xs text-gray-400">
              {style.manufacturer.role === "IMPORTER" ? "수입자" : "제조자"} · {style.manufacturer.name}
            </p>
          )}
        </section>

        {measureColumns.length > 0 && (
          <section className="md:col-span-2">
            <h2 className="text-lg font-bold text-gray-900">
              실측 사이즈 <span className="text-sm font-normal text-gray-500">(cm)</span>
            </h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-max text-center text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">사이즈</th>
                    {measureColumns.map((col) => (
                      <th key={col.value} className="px-3 py-2 font-medium">{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {measureSizes.map((size) => (
                    <tr key={size.id}>
                      <td className="px-3 py-2 font-medium text-gray-900">{size.label}</td>
                      {measureColumns.map((col) => (
                        <td key={col.value} className="px-3 py-2 text-gray-700">
                          {style.measurements.find(
                            (m) => m.sizeId === size.id && m.item === col.value,
                          )?.valueCm ?? "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              측정 방법에 따라 1~2cm 오차가 있을 수 있습니다.
            </p>
          </section>
        )}

        {style.modelWears.length > 0 && (
          <section>
            <h2 className="text-lg font-bold text-gray-900">모델 정보</h2>
            <ul className="mt-4 space-y-1 text-sm text-gray-700">
              {style.modelWears.map((m) => (
                <li key={m.id}>
                  {m.heightCm}cm{m.weightKg && ` / ${m.weightKg}kg`} ·{" "}
                  {m.styleColor && `${m.styleColor.colorLabel ?? m.styleColor.color.name} `}
                  {m.size.label} 착용
                  {m.note && <span className="text-gray-500"> ({m.note})</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {notice.length > 0 && (
          <section className="md:col-span-2">
            <h2 className="text-lg font-bold text-gray-900">상품정보제공고시</h2>
            <table className="mt-4 w-full text-sm">
              <tbody className="divide-y divide-gray-100 border-y border-gray-200">
                {notice.map((row) => (
                  <tr key={row.label}>
                    <th className="w-44 bg-gray-50 px-3 py-2 text-left font-medium text-gray-600">
                      {row.label}
                    </th>
                    <td className="px-3 py-2 text-gray-800">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </main>
  );
}
