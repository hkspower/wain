-- K-064 §3.5.2 (2026-10-15): the encrypted and the plain-text KNET response, one row per response.
-- Written by knet_store_response() in knet.php. Append-only. Run once on the database the shop uses.
create table if not exists knet_responses (
  id          bigint unsigned not null auto_increment primary key,
  track_id    varchar(30) not null,
  received_at timestamp not null default current_timestamp,
  encrypted   mediumtext not null,
  plaintext   text not null,
  key ix_knet_responses_track (track_id)
) engine = innodb default charset = utf8mb4;
