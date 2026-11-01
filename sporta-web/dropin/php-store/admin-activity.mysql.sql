-- Apply once to an existing Sporta database before using the Activity page.
create table if not exists admin_activity_log (
  id bigint unsigned auto_increment primary key,
  actor_admin_id int unsigned null,
  actor_email varchar(120) not null,
  action_key varchar(80) not null,
  created_at timestamp not null default current_timestamp,
  index idx_admin_activity_created (created_at, id),
  index idx_admin_activity_actor (actor_admin_id, created_at),
  constraint fk_admin_activity_actor foreign key (actor_admin_id)
    references admin_users(id) on delete set null
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
