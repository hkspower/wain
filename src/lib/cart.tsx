/**
 * The basket, plus the catalogue it is priced against.
 *
 * A line is identified by (slug, size) — the same shirt in two sizes is two
 * lines, and adding a size that is already in the basket increases that line
 * rather than appending a duplicate.
 *
 * The basket is PERSISTED. A shopper is interrupted — a call, a lock screen,
 * an app the OS decided to evict — and coming back to an empty basket is the
 * moment they stop. Only (slug, size, qty) is stored; prices and stock are read
 * from the catalogue on every render, so a basket restored a week later is
 * priced today rather than at whatever the shop charged when it was filled.
 *
 * STOCK IS CAPPED HERE, not at the button. Every path that can raise a
 * quantity — the product page, the stepper in the basket, a second add of the
 * same size — goes through `add`, so the cap cannot be bypassed by using a
 * different one. `add` reports whether it capped, so the screen can say "that
 * is all we have" instead of silently ignoring the tap.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { fetchCatalogue, type Source } from '@/lib/api';
import {
  categories as bundledCategories,
  products as bundledProducts,
  stockFor,
  type Category,
  type Product,
} from '@/lib/catalog';
import type { Fils } from '@/lib/money';
import { KEYS, readJson, writeJson } from '@/lib/storage';

export interface Line {
  slug: string;
  size: string;
  qty: number;
}

/**
 * The guard the stored basket is read through. Storage is not a trusted input:
 * it survives app upgrades that change this shape, and a malformed basket must
 * not be allowed to take the shop down on launch.
 */
const isLastOrder = (v: unknown): v is { ref: string; phone: string } | null =>
  v === null ||
  (!!v && typeof (v as { ref?: unknown }).ref === 'string' && typeof (v as { phone?: unknown }).phone === 'string');

const isLines = (value: unknown): value is Line[] =>
  Array.isArray(value) &&
  value.every(
    (l) =>
      !!l &&
      typeof (l as Line).slug === 'string' &&
      typeof (l as Line).size === 'string' &&
      Number.isFinite((l as Line).qty),
  );

/**
 * DELIVERY IS 1 KWD, FLAT — the server's number, not a second opinion.
 *
 * store.php: `const STORE_DELIVERY_FEE_FILS = 1000`, added to every order,
 * every governorate, every payment method, with no free-over threshold of any
 * kind. The app quoted 1.500 and promised free delivery over 20 KWD, so a
 * customer with a 30 KWD basket was shown "Delivery: free, total 30.000" and
 * the bank then took 31.000 — measured against the real api.php, order
 * SPDELIV2: subtotal 30.000, delivery 1.000, amount 31.000.
 *
 * A total the customer is shown has to be the total they are charged. If the
 * fee or a free-delivery threshold is ever wanted, it belongs in store.php
 * first and here second.
 */
export const DELIVERY_FEE: Fils = 1_000;

type Ctx = {
  products: Product[];
  categories: Category[];
  source: Source;
  loading: boolean;
  /**
   * True once the stored basket has been read. The web build is server-
   * rendered, and the server has no localStorage — so anything derived from
   * the basket must render as empty until this flips, or React tears the tree
   * down and rebuilds it (hydration error #418) the first time a returning
   * customer opens the site with something in their cart.
   */
  ready: boolean;
  lines: Line[];
  count: number;
  subtotal: Fils;
  delivery: Fils;
  total: Fils;
  /**
   * The last order placed on this device — the phone it was placed with and
   * its reference. It is the closest thing to a customer identity a shop with
   * no accounts has, and it is what the Wallet endpoint asks for.
   */
  lastOrder: { ref: string; phone: string } | null;
  remember: (order: { ref: string; phone: string }) => void;
  /** Returns false when the requested quantity was capped by stock. */
  add: (slug: string, size: string, qty?: number) => boolean;
  setQty: (slug: string, size: string, qty: number) => boolean;
  remove: (slug: string, size: string) => void;
  clear: () => void;
  productFor: (slug: string) => Product | undefined;
};

const CartContext = createContext<Ctx | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>(bundledProducts);
  const [categories, setCategories] = useState<Category[]>(bundledCategories);
  const [source, setSource] = useState<Source>('bundled');
  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);
  const [lastOrder, setLastOrder] = useState<{ ref: string; phone: string } | null>(null);
  // Until the stored basket has been read, writes are suppressed: the first
  // render has an empty basket, and saving that would erase what is on disk
  // before it is ever loaded.
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      readJson(KEYS.cart, isLines, [] as Line[]),
      readJson(KEYS.lastOrder, isLastOrder, null as { ref: string; phone: string } | null),
    ])
      .then(([lines, order]) => {
        if (!alive) return;
        setLines(lines);
        setLastOrder(order);
      })
      .finally(() => alive && setRestored(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!restored) return;
    writeJson(KEYS.cart, lines);
  }, [lines, restored]);

  useEffect(() => {
    let alive = true;
    fetchCatalogue()
      .then((c) => {
        if (!alive) return;
        setProducts(c.products);
        setCategories(c.categories);
        setSource(c.source);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const productFor = useCallback(
    (slug: string) => products.find((p) => p.slug === slug),
    [products],
  );

  const capFor = useCallback(
    (slug: string, size: string) => {
      const p = productFor(slug);
      return p ? stockFor(p, size) : 0;
    },
    [productFor],
  );

  const setQty = useCallback(
    (slug: string, size: string, qty: number) => {
      const cap = capFor(slug, size);
      const wanted = Math.max(0, Math.round(qty));
      const allowed = Math.min(wanted, cap);
      setLines((prev) => {
        const rest = prev.filter((l) => !(l.slug === slug && l.size === size));
        return allowed > 0 ? [...rest, { slug, size, qty: allowed }] : rest;
      });
      return allowed === wanted;
    },
    [capFor],
  );

  const add = useCallback(
    (slug: string, size: string, qty = 1) => {
      const have = lines.find((l) => l.slug === slug && l.size === size)?.qty ?? 0;
      return setQty(slug, size, have + qty);
    },
    [lines, setQty],
  );

  const remove = useCallback((slug: string, size: string) => {
    setLines((prev) => prev.filter((l) => !(l.slug === slug && l.size === size)));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const remember = useCallback((order: { ref: string; phone: string }) => {
    setLastOrder(order);
    writeJson(KEYS.lastOrder, order);
  }, []);

  const { count, subtotal } = useMemo(() => {
    let count = 0;
    let subtotal = 0;
    for (const l of lines) {
      const p = productFor(l.slug);
      if (!p) continue;
      count += l.qty;
      subtotal += p.price * l.qty;
    }
    return { count, subtotal };
  }, [lines, productFor]);

  const delivery = subtotal === 0 ? 0 : DELIVERY_FEE;

  const value = useMemo<Ctx>(
    () => ({
      products,
      categories,
      source,
      loading,
      ready: restored,
      lastOrder,
      remember,
      lines,
      count,
      subtotal,
      delivery,
      total: subtotal + delivery,
      add,
      setQty,
      remove,
      clear,
      productFor,
    }),
    [products, categories, source, loading, restored, lastOrder, remember, lines, count, subtotal, delivery, add, setQty, remove, clear, productFor],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): Ctx {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
