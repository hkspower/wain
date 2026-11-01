-- Customer-support tickets.  A ticket reference and the email supplied when
-- opening it are required for public lookup; staff notes are kept separate
-- from customer-visible replies.
create table if not exists support_tickets (
  id bigint unsigned auto_increment primary key,
  reference varchar(24) not null unique,
  customer_name varchar(80) not null,
  customer_email varchar(120) not null,
  customer_phone varchar(15) null,
  order_track_id varchar(30) null,
  subject varchar(140) not null,
  status varchar(16) not null default 'open',
  priority varchar(12) not null default 'normal',
  assigned_to varchar(120) null,
  last_customer_at timestamp null,
  last_staff_at timestamp null,
  resolved_at timestamp null,
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp on update current_timestamp,
  constraint support_ticket_status_ck check (status in ('open','waiting_customer','in_progress','resolved','closed')),
  constraint support_ticket_priority_ck check (priority in ('low','normal','high','urgent'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_support_ticket_queue on support_tickets (status, priority, updated_at, id);
create index if not exists idx_support_ticket_email on support_tickets (customer_email, created_at);
create index if not exists idx_support_ticket_order on support_tickets (order_track_id);

create table if not exists support_messages (
  id bigint unsigned auto_increment primary key,
  ticket_id bigint unsigned not null,
  author_kind varchar(12) not null,
  author_name varchar(120) null,
  body text not null,
  visible_to_customer tinyint(1) not null default 1,
  created_at timestamp not null default current_timestamp,
  constraint support_message_author_ck check (author_kind in ('customer','staff','internal')),
  constraint fk_support_message_ticket foreign key (ticket_id) references support_tickets(id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_support_message_ticket on support_messages (ticket_id, id);
