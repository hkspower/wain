-- ===========================================================================
-- Sporta — customer reviews, and the thank-you discount.
--
-- Additive, and byte-for-byte the same statements as the ones in
-- schema.mysql.sql. `if not exists`, so importing it twice changes nothing.
--
-- ---------------------------------------------------------------------------
-- THE REWARD IS FOR REVIEWING **SPORTA**, NOT FOR REVIEWING ON GOOGLE.
--
-- That distinction is the whole design, and it is not a technicality. Google's
-- policy forbids offering anything of value in exchange for a review, and the
-- penalty is not a warning: Google removes the reviews and can suspend the
-- Business Profile. A shop that buys fifty reviews and loses all of them plus
-- its listing is worse off than one that never asked.
--
-- So the shop asks for its OWN review — first-party, stored in this table —
-- and pays 20% for it, which is an ordinary loyalty offer and nobody's policy
-- violation. AFTER the review is submitted, and only then, the thank-you page
-- links to Google with no reward attached and no obligation. The customer who
-- has just said something nice is the one most likely to say it again; that is
-- the entire mechanism, and it is allowed precisely because the discount is
-- already theirs either way.
--
-- ANY RATING EARNS IT — one star included. This is deliberate and it is also
-- what keeps the shop out of the other trap. Paying only for four and five
-- stars is "review gating": it is against Google's policy in its own right, it
-- is illegal in several markets, and it turns the shop's own ratings into a
-- number that means nothing because the unhappy customers were filtered out.
-- One star and a paragraph about a late delivery is the single most valuable
-- thing this table will ever hold.
--
-- ONE REVIEW PER ORDER, enforced by the unique index below rather than by the
-- application. It is the only thing standing between this feature and a
-- discount-code printer: without it a customer submits the same order twenty
-- times and collects twenty codes. The uniqueness lives in the database
-- because that is the one place a race cannot get around it.
-- ===========================================================================

create table if not exists reviews (
  id          int unsigned auto_increment primary key,
  order_id    int unsigned not null,
  -- 1..5. Checked here as well as in PHP: this column is the shop's rating,
  -- and a 0 or a 7 in it is a number that would be averaged into a lie.
  rating      tinyint unsigned not null,
  -- Optional. A rating alone is a signal; a sentence is the reason.
  comment     varchar(1000) null,
  -- Which language they wrote in, so the admin reads it in the right direction
  -- and the shop can answer in the language they chose.
  lang        varchar(2)   not null default 'ar',
  -- The code this review earned. Kept ON THE REVIEW so "what did we give away,
  -- and for what" is one query rather than a reconciliation.
  reward_code varchar(24)  null,
  -- Shown on the site, or not. New reviews are NOT published automatically:
  -- this column is what stops a competitor or a bot putting whatever they like
  -- on the shop's own pages.
  published   tinyint(1)   not null default 0,
  created_at  timestamp    not null default current_timestamp,
  -- THE ANTI-ABUSE PROPERTY. One row per order, in the database, so twenty
  -- simultaneous submissions produce one review and one code.
  unique key uq_reviews_order (order_id),
  key idx_reviews_created (created_at),
  constraint reviews_rating_ck check (rating between 1 and 5),
  constraint reviews_lang_ck   check (lang in ('ar','en'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- The invitation is a WhatsApp message, so the outbox has to accept its kind.
--
-- whatsapp_outbox.kind is guarded by a CHECK that listed only 'confirmed' and
-- 'shipped'. Without this the queue insert fails and the review is never
-- requested — silently, because store_queue_whatsapp is called from inside the
-- admin's fulfilment write and a thrown constraint there would roll back the
-- delivery status too.
--
-- Dropped and re-added rather than edited: MySQL has no ALTER for a CHECK's
-- body. The name is kept, so schema.mysql.sql and this file still describe the
-- same constraint.
alter table whatsapp_outbox drop constraint if exists wa_kind_ck;
alter table whatsapp_outbox add constraint wa_kind_ck
  check (kind in ('confirmed','shipped','review'));
