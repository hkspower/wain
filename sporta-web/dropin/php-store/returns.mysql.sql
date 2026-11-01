-- Additive, repeatable return/exchange workflow for existing Sporta orders.
-- Requests and their items never change payment or stock automatically.
create table if not exists return_requests (
  id bigint unsigned auto_increment primary key,
  reference varchar(24) not null unique,
  order_id int unsigned not null,
  status varchar(24) not null default 'submitted',
  eligibility varchar(20) not null,
  contact_phone varchar(15) not null,
  customer_note text null,
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp on update current_timestamp,
  reviewed_by varchar(120) null,
  -- v2 names intentionally avoid collisions with archived legacy return tables.
  constraint fk_return_order_v2 foreign key (order_id) references orders(id),
  constraint return_status_ck_v2 check (status in
    ('submitted','under_review','approved','declined','pickup_scheduled','received','completed','cancelled')),
  constraint return_eligibility_ck check (eligibility in ('standard','manual_review'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_return_order_created on return_requests (order_id, created_at);
create index if not exists idx_return_status_created on return_requests (status, created_at);

create table if not exists return_request_items (
  id bigint unsigned auto_increment primary key,
  request_id bigint unsigned not null,
  order_item_id int unsigned not null,
  action varchar(10) not null,
  reason varchar(20) not null,
  qty int unsigned not null,
  requested_size varchar(4) null,
  name_en varchar(160) not null,
  name_ar varchar(160) not null,
  original_size varchar(4) null,
  original_fit varchar(10) null,
  unit_price decimal(10,3) not null,
  constraint fk_return_item_request foreign key (request_id)
    references return_requests(id) on delete cascade,
  constraint fk_return_item_order_item foreign key (order_item_id)
    references order_items(id),
  constraint return_item_action_ck check (action in ('return','exchange')),
  constraint return_item_reason_ck check (reason in
    ('size','damaged','not_as_described','changed_mind','other')),
  constraint return_item_qty_ck check (qty between 1 and 99),
  constraint return_item_size_ck check (requested_size is null or requested_size in
    ('S','M','L','XL','2XL','3XL','4XL','5XL','ONE')),
  unique key uq_return_request_order_item (request_id, order_item_id)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_return_item_order_item on return_request_items (order_item_id);

create table if not exists return_request_events (
  id bigint unsigned auto_increment primary key,
  request_id bigint unsigned not null,
  from_status varchar(24) null,
  to_status varchar(24) not null,
  actor_type varchar(10) not null,
  actor varchar(120) null,
  note text null,
  created_at timestamp not null default current_timestamp,
  constraint fk_return_event_request foreign key (request_id)
    references return_requests(id) on delete cascade,
  constraint return_actor_ck check (actor_type in ('customer','admin'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_return_event_request on return_request_events (request_id, id);
