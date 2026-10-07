-- The API's token bucket (2026-10-07). One row per hashed (bucket, IP): the tokens left and when they were last
-- topped up. Safe to re-run: `create table if not exists` and nothing else. Until it exists store_throttle() falls
-- back to the fixed-window rate_limit table, so running this before or after publishing the code is equally fine.
-- The IP is hashed, as in rate_limit: this is abuse control, not a visitor log.
create table if not exists rate_bucket (
  bucket_key  char(32)   not null,
  tokens      double     not null,
  refilled_at double     not null,
  allowed     tinyint(1) not null default 1,
  primary key (bucket_key),
  key idx_rate_bucket_sweep (refilled_at)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
