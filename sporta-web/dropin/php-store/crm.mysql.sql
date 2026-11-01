-- Internal CRM annotations. Contacts are operational records, never a proof
-- that a phone number belongs to a registered account. Account and guest-phone
-- keys remain separate even when their phone strings happen to match.
create index if not exists idx_crm_orders_contact_latest
  on orders (customer_account_id, customer_phone, created_at, id);

create table if not exists crm_contacts (
  contact_key varchar(40) not null primary key,
  display_name varchar(80) null,
  status varchar(16) not null default 'new',
  tags_json text null,
  follow_up_at date null,
  created_by varchar(120) not null,
  updated_by varchar(120) not null,
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp on update current_timestamp,
  constraint crm_contact_status_ck check (status in ('new','active','follow_up','vip','inactive'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_crm_contact_follow_up on crm_contacts (follow_up_at, status);

create table if not exists crm_notes (
  id bigint unsigned auto_increment primary key,
  contact_key varchar(40) not null,
  note text not null,
  created_by varchar(120) not null,
  created_at timestamp not null default current_timestamp,
  constraint fk_crm_note_contact foreign key (contact_key)
    references crm_contacts (contact_key) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_crm_note_contact on crm_notes (contact_key, id);
