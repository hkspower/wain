/**
 * Nokha1 (النوخذة) — core types, persistence, and business logic.
 * All data is stored on-device via AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/* ---------------------------------- SAFI ---------------------------------- */

export type Holding = {
  ticker: string;
  name: string;
  qty: number;
  /** average cost per share, in fils (1 KWD = 1000 fils) */
  cost: number;
  /** current price per share, in fils */
  price: number;
};

const SAFI_KEY = 'nokha1-safi-v1';

export const filsToKwd = (fils: number) => fils / 1000;

export function cleanTicker(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 12);
}

export function cleanNum(v: unknown, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
}

export function holdingValue(h: Holding) {
  const cost = filsToKwd(h.qty * h.cost);
  const value = filsToKwd(h.qty * h.price);
  return { cost, value, pl: value - cost, pct: cost > 0 ? ((value - cost) / cost) * 100 : 0 };
}

function sanitizeHolding(h: Holding): Holding {
  return {
    ticker: cleanTicker(String(h.ticker ?? '')),
    name: String(h.name ?? '').slice(0, 80),
    qty: Math.floor(cleanNum(h.qty, 1e9)),
    cost: cleanNum(h.cost, 1e7),
    price: cleanNum(h.price, 1e7),
  };
}

export async function loadHoldings(): Promise<Holding[]> {
  try {
    const raw = await AsyncStorage.getItem(SAFI_KEY);
    const list = raw ? (JSON.parse(raw) as Holding[]) : [];
    return Array.isArray(list) ? list.map(sanitizeHolding) : [];
  } catch {
    return [];
  }
}

export async function saveHoldings(list: Holding[]): Promise<void> {
  try {
    await AsyncStorage.setItem(SAFI_KEY, JSON.stringify(list.map(sanitizeHolding)));
  } catch {
    // storage unavailable — data stays in memory for this session
  }
}

export function holdingsCsv(list: Holding[]): string {
  const lines = ['Ticker,Company,Qty,AvgCostFils,PriceFils,ValueKWD,PLKWD'];
  for (const h of list) {
    const { value, pl } = holdingValue(h);
    // Neutralize leading =,+,-,@ so a company name can't become a spreadsheet formula.
    let name = h.name;
    if (/^[=+\-@]/.test(name)) name = "'" + name;
    lines.push(
      [h.ticker, `"${name.replace(/"/g, '""')}"`, h.qty, h.cost, h.price, value.toFixed(3), pl.toFixed(3)].join(','),
    );
  }
  return lines.join('\n');
}

/* ---------------------------------- XBRL ---------------------------------- */

export type XbrlInput = {
  entity: string;
  lei: string;
  period: 'Q1' | 'Q2' | 'Q3' | 'FY';
  /** YYYY-MM-DD */
  periodEnd: string;
  currentAssets: number;
  nonCurrentAssets: number;
  currentLiabilities: number;
  nonCurrentLiabilities: number;
  equity: number;
  revenue: number;
  expenses: number;
};

export function xbrlBalance(x: XbrlInput) {
  const assets = x.currentAssets + x.nonCurrentAssets;
  const liabEq = x.currentLiabilities + x.nonCurrentLiabilities + x.equity;
  return { assets, liabEq, diff: assets - liabEq, balanced: Math.abs(assets - liabEq) < 0.0005 };
}

const escXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildXbrl(x: XbrlInput): string {
  const endDate = new Date(x.periodEnd + 'T00:00:00');
  const start = new Date(endDate);
  if (x.period === 'FY') start.setFullYear(start.getFullYear() - 1);
  else start.setMonth(start.getMonth() - 3);
  start.setDate(start.getDate() + 1);
  const startStr = start.toISOString().slice(0, 10);
  const lei = x.lei.replace(/[^A-Za-z0-9]/g, '').slice(0, 40);

  const fact = (tag: string, ctx: 'AsOf' | 'Duration', val: number) =>
    `  <ifrs-full:${tag} contextRef="${ctx}" unitRef="KWD" decimals="3">${val.toFixed(3)}</ifrs-full:${tag}>`;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xbrl xmlns="http://www.xbrl.org/2003/instance"',
    '      xmlns:xbrli="http://www.xbrl.org/2003/instance"',
    '      xmlns:ifrs-full="https://xbrl.ifrs.org/taxonomy/2024-03-27/ifrs-full"',
    '      xmlns:iso4217="http://www.xbrl.org/2003/iso4217">',
    '  <context id="AsOf">',
    `    <entity><identifier scheme="http://standards.iso.org/iso/17442">${escXml(lei)}</identifier></entity>`,
    `    <period><instant>${x.periodEnd}</instant></period>`,
    '  </context>',
    '  <context id="Duration">',
    `    <entity><identifier scheme="http://standards.iso.org/iso/17442">${escXml(lei)}</identifier></entity>`,
    `    <period><startDate>${startStr}</startDate><endDate>${x.periodEnd}</endDate></period>`,
    '  </context>',
    '  <unit id="KWD"><measure>iso4217:KWD</measure></unit>',
    `  <!-- ${escXml(x.entity)} — ${x.period} ending ${x.periodEnd} -->`,
    fact('CurrentAssets', 'AsOf', x.currentAssets),
    fact('NoncurrentAssets', 'AsOf', x.nonCurrentAssets),
    fact('Assets', 'AsOf', x.currentAssets + x.nonCurrentAssets),
    fact('CurrentLiabilities', 'AsOf', x.currentLiabilities),
    fact('NoncurrentLiabilities', 'AsOf', x.nonCurrentLiabilities),
    fact('Liabilities', 'AsOf', x.currentLiabilities + x.nonCurrentLiabilities),
    fact('Equity', 'AsOf', x.equity),
    fact('EquityAndLiabilities', 'AsOf', x.currentLiabilities + x.nonCurrentLiabilities + x.equity),
    fact('Revenue', 'Duration', x.revenue),
    fact('ExpensesByNature', 'Duration', x.expenses),
    fact('ProfitLoss', 'Duration', x.revenue - x.expenses),
    '</xbrl>',
  ].join('\n');
}

/* -------------------------------- Delivery -------------------------------- */

export const ORDER_STATUSES = ['جديد', 'قيد التحضير', 'في الطريق', 'تم التسليم', 'ملغي'] as const;
export const STATUS_DELIVERED = 3;
export const STATUS_CANCELLED = 4;

export type Order = {
  id: string;
  customer: string;
  phone: string;
  address: string;
  items: string;
  amount: number;
  courier: string;
  status: number;
  createdAt: string;
};

export type Courier = { name: string; phone: string };

const ORDERS_KEY = 'nokha1-delivery-orders-v1';
const COURIERS_KEY = 'nokha1-delivery-couriers-v1';

export function nextOrderId(orders: Order[]): string {
  let max = 0;
  for (const o of orders) {
    const n = Number(String(o.id).slice(4));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return 'ORD-' + String(max + 1).padStart(4, '0');
}

function sanitizeOrder(o: Order): Order {
  return {
    id: String(o.id ?? '').slice(0, 12),
    customer: String(o.customer ?? '').slice(0, 80),
    phone: String(o.phone ?? '').replace(/[^0-9+ ]/g, '').slice(0, 15),
    address: String(o.address ?? '').slice(0, 160),
    items: String(o.items ?? '').slice(0, 160),
    amount: cleanNum(o.amount, 1e6),
    courier: String(o.courier ?? '').slice(0, 80),
    status: Math.min(Math.max(Math.floor(Number(o.status) || 0), 0), ORDER_STATUSES.length - 1),
    createdAt: String(o.createdAt ?? ''),
  };
}

async function loadList<T>(key: string, sanitize: (item: T) => T): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const list = raw ? (JSON.parse(raw) as T[]) : [];
    return Array.isArray(list) ? list.map(sanitize) : [];
  } catch {
    return [];
  }
}

async function saveList<T>(key: string, list: T[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(list));
  } catch {
    // storage unavailable
  }
}

export const loadOrders = () => loadList<Order>(ORDERS_KEY, sanitizeOrder);
export const saveOrders = (orders: Order[]) => saveList(ORDERS_KEY, orders.map(sanitizeOrder));

const sanitizeCourier = (c: Courier): Courier => ({
  name: String(c.name ?? '').slice(0, 80),
  phone: String(c.phone ?? '').replace(/[^0-9+ ]/g, '').slice(0, 15),
});

export const loadCouriers = () => loadList<Courier>(COURIERS_KEY, sanitizeCourier);
export const saveCouriers = (couriers: Courier[]) => saveList(COURIERS_KEY, couriers.map(sanitizeCourier));

export function orderStats(orders: Order[]) {
  const delivered = orders.filter((o) => o.status === STATUS_DELIVERED);
  return {
    total: orders.length,
    active: orders.filter((o) => o.status < STATUS_DELIVERED).length,
    delivered: delivered.length,
    revenue: delivered.reduce((s, o) => s + o.amount, 0),
  };
}

/* --------------------------------- Units ---------------------------------- */

export type ServiceUnit = {
  id: string;
  emoji: string;
  title: string;
  titleEn: string;
  blurb: string;
  href: '/nokha1/safi' | '/nokha1/xbrl' | '/nokha1/delivery';
};

export const serviceUnits: ServiceUnit[] = [
  {
    id: 'safi',
    emoji: '📊',
    title: 'صافي',
    titleEn: 'SAFI — Portfolio',
    blurb: 'متابعة المحفظة: التكلفة والقيمة السوقية والربح/الخسارة، وتصدير الكشوفات.',
    href: '/nokha1/safi',
  },
  {
    id: 'xbrl',
    emoji: '🧾',
    title: 'XBRL',
    titleEn: 'Financial Reports',
    blurb: 'إعداد القوائم المالية والتحقق من توازنها وتوليد ملف XBRL جاهز للإيداع.',
    href: '/nokha1/xbrl',
  },
  {
    id: 'delivery',
    emoji: '🛵',
    title: 'التوصيل',
    titleEn: 'Delivery',
    blurb: 'إدارة الطلبات والمناديب: من «جديد» إلى «تم التسليم» مع الإحصائيات.',
    href: '/nokha1/delivery',
  },
];
