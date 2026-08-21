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

import AsyncStorage from '@react-native-async-storage/async-storage';
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

export interface Line {
  slug: string;
  size: string;
  qty: number;
}

/** Free delivery over 20 KD; below it, 1.500 KD. Both in fils. */
export const FREE_DELIVERY_OVER: Fils = 20_000;
export const DELIVERY_FEE: Fils = 1_500;

const STORAGE_KEY = 'sporta.cart.v1';

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
  // Until the stored basket has been read, writes are suppressed: the first
  // render has an empty basket, and saving that would erase what is on disk
  // before it is ever loaded.
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        const parsed: unknown = JSON.parse(raw);
        // Storage is not a trusted input: it survives app upgrades that change
        // this shape, and a malformed basket must not take the shop down.
        if (Array.isArray(parsed)) {
          setLines(
            parsed.filter(
              (l): l is Line =>
                !!l &&
                typeof (l as Line).slug === 'string' &&
                typeof (l as Line).size === 'string' &&
                Number.isFinite((l as Line).qty),
            ),
          );
        }
      })
      .catch(() => {})
      .finally(() => alive && setRestored(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!restored) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(lines)).catch(() => {});
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

  const delivery = subtotal === 0 || subtotal >= FREE_DELIVERY_OVER ? 0 : DELIVERY_FEE;

  const value = useMemo<Ctx>(
    () => ({
      products,
      categories,
      source,
      loading,
      ready: restored,
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
    [products, categories, source, loading, restored, lines, count, subtotal, delivery, add, setQty, remove, clear, productFor],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): Ctx {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
