"use client";

// 장바구니 상태를 앱 전체에서 함께 쓰기 위한 "Context"입니다.
// "use client": 브라우저에서 동작하는 코드라는 표시 (localStorage 사용)

import { createContext, useContext, useSyncExternalStore } from "react";

export type CartItem = {
  productId: number;
  quantity: number;
};

type CartContextValue = {
  items: CartItem[];
  totalQuantity: number;
  addItem: (productId: number, quantity?: number) => void;
  updateQuantity: (productId: number, quantity: number) => void;
  removeItem: (productId: number) => void;
  clearCart: () => void;
};

// ---------------------------------------------------------------
// 1) localStorage에 장바구니를 저장하고 읽는 "저장소"
//    React 바깥의 데이터(localStorage)는 useSyncExternalStore로 읽는 것이 정석입니다.
// ---------------------------------------------------------------
// 3단계에서 상품 id가 숫자로 바뀌어서 저장 이름도 바꿨습니다 (예전 장바구니는 무시)
const STORAGE_KEY = "my-shop-cart-v2";
const EMPTY: CartItem[] = [];

const listeners = new Set<() => void>();

// 같은 문자열이면 같은 배열을 돌려줘야 React가 "안 바뀌었다"고 판단합니다.
let cachedRaw: string | null = null;
let cachedItems: CartItem[] = EMPTY;

function readCart(): CartItem[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedItems = raw ? JSON.parse(raw) : EMPTY;
    } catch {
      cachedItems = EMPTY; // 저장된 값이 깨졌으면 빈 장바구니
    }
  }
  return cachedItems;
}

function writeCart(items: CartItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  listeners.forEach((listener) => listener()); // 화면에 "바뀌었어요" 알림
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // 다른 브라우저 탭에서 장바구니를 바꿔도 반영되도록
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

// ---------------------------------------------------------------
// 2) 장바구니를 바꾸는 함수들
//    컴포넌트 바깥에 두어서 화면이 다시 그려져도 같은 함수가 유지됩니다.
// ---------------------------------------------------------------
function addItem(productId: number, quantity = 1) {
  const current = readCart();
  const existing = current.find((item) => item.productId === productId);
  if (existing) {
    // 이미 담긴 상품이면 수량만 늘립니다
    writeCart(
      current.map((item) =>
        item.productId === productId
          ? { ...item, quantity: item.quantity + quantity }
          : item,
      ),
    );
  } else {
    writeCart([...current, { productId, quantity }]);
  }
}

function updateQuantity(productId: number, quantity: number) {
  if (quantity < 1) return; // 1개 미만으로는 줄이지 않음 (삭제는 removeItem)
  writeCart(
    readCart().map((item) =>
      item.productId === productId ? { ...item, quantity } : item,
    ),
  );
}

function removeItem(productId: number) {
  writeCart(readCart().filter((item) => item.productId !== productId));
}

function clearCart() {
  writeCart([]);
}

// ---------------------------------------------------------------
// 3) Provider: 저장소를 읽어서 위 함수들과 함께 제공
// ---------------------------------------------------------------
const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  // 서버에서 그릴 때는 localStorage가 없으므로 빈 장바구니(EMPTY)를 씁니다.
  const items = useSyncExternalStore(subscribe, readCart, () => EMPTY);

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <CartContext.Provider
      value={{ items, totalQuantity, addItem, updateQuantity, removeItem, clearCart }}
    >
      {children}
    </CartContext.Provider>
  );
}

// 다른 컴포넌트에서 const { items, addItem } = useCart(); 처럼 꺼내 씁니다.
export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart는 CartProvider 안에서만 사용할 수 있습니다.");
  }
  return context;
}
