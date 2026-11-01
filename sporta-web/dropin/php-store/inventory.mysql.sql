-- Additive, repeatable inventory foundation for existing Sporta databases.
-- Import this file after the original product/admin schema. It preserves every
-- SKU and stock count and can be imported more than once safely.

alter table product_variants
  add column if not exists low_stock_threshold int unsigned not null default 2 after stock,
  add column if not exists unit_cost_kwd decimal(10,3) null after cost_aed,
  add column if not exists inventory_version bigint unsigned not null default 0 after unit_cost_kwd,
  add column if not exists updated_at timestamp not null default current_timestamp
    on update current_timestamp after inventory_version;

-- 11.95 AED/KWD is the rate recorded with the legacy AHED shipment. Never
-- overwrite a KWD cost an administrator has already entered.
update product_variants
   set unit_cost_kwd = round(cost_aed / 11.95, 3)
 where unit_cost_kwd is null and cost_aed is not null;

create table if not exists inventory_movements (
  id bigint unsigned auto_increment primary key,
  sku varchar(30) not null,
  type varchar(20) not null,
  before_stock int unsigned not null,
  after_stock int unsigned not null,
  delta int not null,
  before_unit_cost_kwd decimal(10,3) null,
  after_unit_cost_kwd decimal(10,3) null,
  before_low_stock_threshold int unsigned not null,
  after_low_stock_threshold int unsigned not null,
  inventory_version bigint unsigned not null,
  note varchar(500) not null,
  actor_admin_id int unsigned null,
  actor_email varchar(120) not null,
  created_at timestamp not null default current_timestamp,
  constraint inventory_movement_variant_fk
    foreign key (sku) references product_variants(sku),
  constraint inventory_movement_admin_fk
    foreign key (actor_admin_id) references admin_users(id) on delete set null,
  constraint inventory_movement_type_ck check (type in
    ('receive','return','damage','count','variant_update','legacy_set_stock')),
  constraint inventory_movement_stock_ck check
    (before_stock <= 999999 and after_stock <= 999999
     and cast(after_stock as signed) = cast(before_stock as signed) + delta)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_inventory_movements_sku_id
  on inventory_movements (sku, id);
create index if not exists idx_inventory_movements_created_id
  on inventory_movements (created_at, id);
