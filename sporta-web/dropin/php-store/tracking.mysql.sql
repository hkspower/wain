-- Customer-visible order progress. No address, payment credential, operator,
-- or internal note belongs here: this is the timeline returned to a holder of
-- the high-entropy order number.
create table if not exists order_tracking_events (
  id          bigint unsigned auto_increment primary key,
  order_id    int unsigned not null,
  status      varchar(12) not null,
  created_at  timestamp not null default current_timestamp,
  constraint fk_tracking_order foreign key (order_id) references orders (id) on delete cascade,
  constraint tracking_status_ck check (status in ('unfulfilled','packed','shipped','delivered','cancelled'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_tracking_order_time on order_tracking_events (order_id, id);
