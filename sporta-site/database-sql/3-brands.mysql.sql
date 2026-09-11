-- Sporta — the brands table, for a shop that was set up BEFORE this feature.
--
-- Fresh installs get it from schema.mysql.sql already; running this as well is
-- harmless (create table if not exists). phpMyAdmin -> your database -> Import.
--
-- It seeds the brands the catalogue already mentions, so the screen is not
-- empty on the first visit. Names only — add each logo in the admin.

set names utf8mb4;

create table if not exists brands (
  id        int unsigned auto_increment primary key,
  slug      varchar(80)  not null unique,
  name_en   varchar(80)  not null,
  name_ar   varchar(80)  not null,
  logo      mediumtext   null,
  active    tinyint(1)   not null default 1,
  sort      int          not null default 0,
  created_at timestamp   not null default current_timestamp,
  updated_at timestamp   not null default current_timestamp on update current_timestamp
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

insert into brands (slug, name_en, name_ar, sort) values
  ('sporta',       'Sporta',        'سبورتا',        0),
  ('ahed',         'AHED',          'عهد',           1),
  ('rheo',         'RHEO',          'ريو',           2),
  ('vanquish',     'Vanquish',      'فانكويش',       3),
  ('ate',          'ATE',           'إيه تي إي',     4),
  ('gymshark',     'Gymshark',      'جيم شارك',      5),
  ('eyesportwear', 'Eyesportwear',  'آي سبورت وير',  6),
  ('nba',          'NBA',           'إن بي إيه',     7)
-- Same rule as the products seed: a brand already in the database keeps the
-- name it has. Less costly than a reset price — nothing on the site lists
-- brands by name today — but it is the owner's text either way, and a file
-- that promises not to overwrite should not overwrite anything.
on duplicate key update slug = slug;   -- never clobber a value already set
