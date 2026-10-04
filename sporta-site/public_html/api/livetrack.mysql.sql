-- Live order tracking (2026-10-04). Safe to run twice; adds and never drops data.
--
--  orders.packed_at / shipped_at   when each step happened, so /track shows a time per step
--  orders.courier / courier_ref    the carrier and its tracking number (/track links to the carrier)
--  order_location                  the driver's last position for an order on its way (one row per
--                                  order, overwritten; deleted when the order is delivered or cancelled)
--  whatsapp_outbox.kind            'packed' and 'delivered' join the three kinds the queue knew
set names utf8mb4;

alter table orders add column if not exists packed_at   timestamp null default null;
alter table orders add column if not exists shipped_at  timestamp null default null;
alter table orders add column if not exists courier     varchar(24) null default null;
alter table orders add column if not exists courier_ref varchar(80) null default null;

create table if not exists order_location (
  order_id    int unsigned not null primary key,
  lat         decimal(9,6) not null,
  lng         decimal(9,6) not null,
  accuracy_m  int unsigned null,
  updated_at  timestamp not null default current_timestamp on update current_timestamp,
  constraint fk_loc_order foreign key (order_id) references orders(id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

alter table whatsapp_outbox drop constraint if exists wa_kind_ck;
alter table whatsapp_outbox add constraint wa_kind_ck
  check (kind in ('confirmed','packed','shipped','delivered','review'));
