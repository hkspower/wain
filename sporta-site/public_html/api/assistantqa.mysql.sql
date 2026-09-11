-- سبورتا AI — the answers the shop writes itself. Additive: safe to run on a
-- live shop.
--
-- WHY THIS TABLE EXISTS. The assistant answers from a fixed set of intents —
-- delivery, payment, returns, sizes, stock, orders — and everything outside
-- that set falls through to "a colleague will follow up" and lands in
-- assistant_outbox. That outbox is already the list of questions the shop
-- could not handle; this table is where the shop writes the answer so the same
-- question is never handed off twice.
--
-- It is NOT a second brain. A row here is the owner's own sentence, returned
-- verbatim — not a prompt, not a hint to a model, not something rephrased on
-- the way out. The assistant's whole design is that a plausible answer is
-- worse than none; a curated answer is the one case where the shop has already
-- decided what the true answer is, so it ships exactly as written.
--
-- TWO LANGUAGES, BOTH REQUIRED. A shop that answers Arabic questions in
-- English has not answered them. The screen asks for both.

set names utf8mb4;

create table if not exists assistant_qa (
  id          int unsigned auto_increment primary key,

  -- WHAT THE CUSTOMER MIGHT ASK, in the owner's words. Matching folds both
  -- sides through assistant_normalise() and then requires every significant
  -- word of this line to appear in the customer's message, so this is a
  -- shortest-form phrase ("هل تفتحون يوم الجمعة" / "open on friday"), not a
  -- sentence to be matched literally. Either language may be left empty when
  -- the question only ever arrives in one of them.
  q_ar        varchar(200) not null default '',
  q_en        varchar(200) not null default '',

  -- WHAT THE SHOP SAYS BACK. Capped at the same 1000 as assistant_outbox.reply
  -- so a curated answer can never be longer than what the outbox can record.
  a_ar        varchar(1000) not null,
  a_en        varchar(1000) not null,

  -- Hidden rather than deleted, the same convention as brands: an answer that
  -- turned out to be wrong should stop being given immediately, and be
  -- readable afterwards by whoever asks why the shop said it.
  active      tinyint(1)   not null default 1,

  -- READ BY THE SCREEN, not by the matcher. "This answer has been used 40
  -- times" is how the owner knows which ones are earning their place, and a
  -- row that has never matched is usually a phrase nobody types.
  hits        int unsigned not null default 0,
  last_hit_at timestamp    null,

  created_at  timestamp    not null default current_timestamp,
  updated_at  timestamp    not null default current_timestamp on update current_timestamp
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- The matcher reads every active row on a miss-heavy path, so the index that
-- matters is the one that keeps hidden rows out of that scan.
create index if not exists idx_assistant_qa_active on assistant_qa (active, id);
