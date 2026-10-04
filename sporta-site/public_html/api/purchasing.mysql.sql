-- Sporta — purchasing: suppliers, purchase orders, and which supplier a size comes from
-- (2026-10-04, "improve inventory" → purchasing & suppliers).
--
-- Safe to re-run: `create table if not exists` and nothing else. ADDS, never drops.
--
-- A purchase order is a list of SKUs with a quantity and the cost agreed; RECEIVING it is the one
-- moment stock moves (admin.php `po_receive`: stock += qty per line, one stock_log row per line with
-- reason 'purchase' and ref 'PO-<id>'). Until then the order is a plan. Cancelling touches no stock.
-- The wholesale cost is kept per line (cost_aed), the same currency product_variants.cost_aed uses,
-- and NEVER reaches a public route.
create table if not exists suppliers (
  id          int unsigned auto_increment primary key,
  name        varchar(80)  not null,
  contact     varchar(160) null,
  lead_days   int unsigned not null default 14,
  note        varchar(300) null,
  created_at  timestamp    not null default current_timestamp
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists variant_supplier (
  sku          varchar(30)  not null primary key,
  supplier_id  int unsigned not null,
  constraint fk_vs_supplier foreign key (supplier_id) references suppliers (id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists purchase_orders (
  id           int unsigned auto_increment primary key,
  supplier_id  int unsigned null,
  status       varchar(10)  not null default 'open',
  note         varchar(300) null,
  expected_on  date         null,
  created_by   varchar(80)  null,
  created_at   timestamp    not null default current_timestamp,
  received_at  timestamp    null,
  constraint po_status_ck check (status in ('open','received','cancelled')),
  constraint fk_po_supplier foreign key (supplier_id) references suppliers (id) on delete set null
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists purchase_order_items (
  id        int unsigned auto_increment primary key,
  po_id     int unsigned not null,
  sku       varchar(30)  not null,
  qty       int unsigned not null,
  cost_aed  decimal(10,2) null,
  constraint fk_poi_po foreign key (po_id) references purchase_orders (id) on delete cascade,
  constraint poi_qty_ck check (qty between 1 and 100000)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_poi_po on purchase_order_items (po_id);
