-- ===========================================================================
-- Sporta — the size and fit adviser.
--
-- Additive, and byte-for-byte the same statements as the block in
-- schema.mysql.sql, so a shop set up before this feature can add it without
-- re-importing. Everything is `if not exists`; importing either file, in any
-- order, any number of times, converges on the same database.
--
-- ---------------------------------------------------------------------------
-- WHY THE MEASUREMENTS ARE A TABLE AND NOT A CONSTANT
--
-- The size guide on the product page was FOUR HARD-CODED ROWS in
-- src/components/SizeGuide.jsx — S, M, L, XL — while the size ladder the shop
-- actually sells runs S to 5XL. A 3XL customer opened the guide and found
-- their size was not in it, on the page where they were deciding whether to
-- risk 10 KWD on a garment they cannot try on.
--
-- It also cannot be a constant because the numbers are NOT ours to invent:
-- they belong to whoever cuts the garments, they differ between a tee and a
-- legging, and they change when a supplier changes. A row can be corrected in
-- /backends in a minute by the person who has the factory's spec sheet in
-- front of them. A constant needs a developer, a build and a deploy.
--
-- THE SEEDED NUMBERS ARE A STARTING POINT AND ARE LABELLED AS ONE. The unisex
-- chart below is exactly the four rows the site has been publishing, continued
-- on the same 8 cm step to 5XL — chosen so the adviser cannot contradict the
-- guide customers have already been reading. The women's chart is a
-- conventional Gulf-market chart. BOTH SHOULD BE REPLACED with the real
-- garment measurements; `is_default` marks a row nobody has confirmed yet, and
-- the admin screen says so in as many words.
--
-- ---------------------------------------------------------------------------
-- WHY THE ADVICE IS LOGGED
--
-- A size recommendation is the one thing this shop says that costs money when
-- it is wrong: the customer returns the garment, the shop pays the free
-- collection, and — for women's clothing, which cannot be exchanged at all —
-- the sale is simply lost. So every recommendation is written down with the
-- answers that produced it, and `outcome` is filled in later from the order.
-- That is what makes the chart improvable rather than merely editable.

set names utf8mb4;

create table if not exists size_charts (
  id         int unsigned auto_increment primary key,
  -- 'unisex', 'women', or a garment kind ('leggings', 'jacket'…). The adviser
  -- looks for the garment's own chart first and falls back to the category's.
  chart      varchar(24)  not null,
  size       varchar(4)   not null,
  -- BODY measurements in centimetres, not garment measurements: this is what
  -- the customer wraps a tape around. The ease the garment adds is the FIT's
  -- job, not the chart's — mixing the two is why "take your normal size" and
  -- a size chart so often disagree on the same page.
  chest_min  smallint unsigned not null,
  chest_max  smallint unsigned not null,
  waist_min  smallint unsigned not null,
  waist_max  smallint unsigned not null,
  -- Hips matter for leggings and for women's sizing generally, and not at all
  -- for a tee. NULL means "this chart does not use hips".
  hip_min    smallint unsigned null,
  hip_max    smallint unsigned null,
  -- Garment length, printed in the guide. Not used by the recommendation.
  length_cm  smallint unsigned null,
  -- 1 = seeded by the migration and never confirmed against a real garment.
  -- The admin screen shows these differently, because advice built on numbers
  -- nobody has checked should not look identical to advice built on the
  -- factory's own spec sheet.
  is_default tinyint(1)   not null default 1,
  sort       smallint     not null default 0,
  unique key uniq_chart_size (chart, size)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists size_advice_log (
  id          int unsigned auto_increment primary key,
  created_at  timestamp    not null default current_timestamp,
  -- What the shopper was looking at, if anything. NULL when the adviser was
  -- opened from the assistant rather than from a product page.
  slug        varchar(80)  null,
  lang        varchar(2)   not null default 'ar',
  -- The answers, as given. Kept as columns rather than JSON because the whole
  -- point of this table is to be able to ask "which answers led to returns".
  height_cm   smallint unsigned null,
  weight_kg   smallint unsigned null,
  chest_cm    smallint unsigned null,
  waist_cm    smallint unsigned null,
  hip_cm      smallint unsigned null,
  usual_size  varchar(4)   null,
  prefers     varchar(10)  null,   -- tight | regular | loose
  -- What the shop said.
  size        varchar(4)   not null,
  fit         varchar(10)  null,
  confidence  varchar(8)   not null,  -- high | medium | low
  -- Filled in later, by hand or by a sweep over orders: 'kept' | 'returned' |
  -- 'exchanged'. NULL means nobody has looked yet. This column is the only
  -- reason the rest of the row is worth storing.
  outcome     varchar(10)  null,
  key idx_advice_recent (created_at),
  key idx_advice_slug (slug)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- The unisex chart: the four rows the site already publishes, continued on the
-- same 8 cm step so the adviser and the printed guide cannot disagree.
insert ignore into size_charts
  (chart, size, chest_min, chest_max, waist_min, waist_max, length_cm, is_default, sort) values
  ('unisex', 'S',    88,  94,  73,  79, 68, 1, 1),
  ('unisex', 'M',    96, 102,  81,  87, 70, 1, 2),
  ('unisex', 'L',   104, 110,  89,  95, 72, 1, 3),
  ('unisex', 'XL',  112, 118,  97, 103, 74, 1, 4),
  ('unisex', '2XL', 120, 126, 105, 111, 76, 1, 5),
  ('unisex', '3XL', 128, 134, 113, 119, 78, 1, 6),
  ('unisex', '4XL', 136, 142, 121, 127, 80, 1, 7),
  ('unisex', '5XL', 144, 150, 129, 135, 82, 1, 8);

-- The women's chart carries hips, because a legging is fitted there and a
-- women's top is cut from the bust rather than the chest.
insert ignore into size_charts
  (chart, size, chest_min, chest_max, waist_min, waist_max, hip_min, hip_max, length_cm, is_default, sort) values
  ('women', 'S',    82,  86,  63,  67,  88,  92, 64, 1, 1),
  ('women', 'M',    87,  91,  68,  72,  93,  97, 65, 1, 2),
  ('women', 'L',    92,  97,  73,  78,  98, 103, 66, 1, 3),
  ('women', 'XL',   98, 104,  79,  85, 104, 110, 67, 1, 4),
  ('women', '2XL', 105, 111,  86,  92, 111, 117, 68, 1, 5),
  ('women', '3XL', 112, 118,  93,  99, 118, 124, 69, 1, 6),
  ('women', '4XL', 119, 125, 100, 106, 125, 131, 70, 1, 7),
  ('women', '5XL', 126, 132, 107, 113, 132, 138, 71, 1, 8);
