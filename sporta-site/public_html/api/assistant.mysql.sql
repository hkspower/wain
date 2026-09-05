-- سبورتا AI — the hand-off queue. Additive: safe to run on a live shop.
--
-- WHY THIS TABLE EXISTS. When the assistant runs out of answers it tells the
-- customer a colleague will follow up. That promise used to be kept by a
-- curl_exec() to n8n whose RESULT WAS NEVER READ — so if n8n was down, slow,
-- rate-limited or returned a 500, the hand-off vanished and the shop had no
-- idea it had happened. A customer had been promised a person and nobody was
-- told. The same reasoning as fulfilment_outbox, which exists because a
-- warehouse message cannot go missing: write the row in the request, send it
-- from a cron that can retry.
--
-- It is also the only record of what the assistant CANNOT answer, which is the
-- list worth reading — every row is a question the shop could not handle.
--
-- NO FOREIGN KEY, deliberately. fulfilment_outbox hangs off orders; most of
-- these questions name no order at all ("do you have this in XL", "are these
-- genuine"), so a key to orders would refuse exactly the rows that matter.

set names utf8mb4;

create table if not exists assistant_outbox (
  id         int unsigned auto_increment primary key,
  intent     varchar(24)  not null,
  lang       varchar(2)   not null default 'ar',
  -- The customer's own words, capped at the same 500 the API caps input to,
  -- so a row can never be larger than what was actually accepted.
  message    varchar(500) not null,
  -- What the shop said back. Kept because the follow-up needs to know what the
  -- customer has ALREADY been told, or the colleague repeats it at them.
  reply      varchar(1000) not null,
  created_at timestamp    not null default current_timestamp,
  -- The queue half. sent_at null = still owed to somebody.
  sent_at    timestamp    null,
  attempts   int          not null default 0,
  last_error varchar(500) null,
  -- Read by the admin screen so a colleague can mark it dealt with by hand,
  -- which is a different thing from "the webhook delivered".
  handled_at timestamp    null
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- The sweep reads unsent rows oldest first; the admin reads recent ones.
create index if not exists idx_assistant_unsent on assistant_outbox (sent_at, created_at);
create index if not exists idx_assistant_recent on assistant_outbox (created_at);
