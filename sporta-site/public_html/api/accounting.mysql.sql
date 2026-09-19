-- Sporta — double-entry accounting.
--
-- ADDITIVE. Safe to run on a live database and safe to run twice.
-- phpMyAdmin -> your database -> Import.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS, AND WHY IT IS DOUBLE ENTRY
--
-- The shop could report its profit straight off the orders table — sum the
-- amounts, subtract the costs — and for a month or two that would agree with
-- reality. It stops agreeing the moment anything happens that is not a sale:
-- rent, a refund, stock bought and not yet sold, the owner putting money in,
-- KNET settling on Tuesday for Sunday's orders. None of those is an order, so
-- none of them appears, and the number quietly becomes a sales figure wearing
-- the word "profit".
--
-- Double entry fixes that by construction rather than by diligence. Every
-- event is recorded twice, once as where the value went and once as where it
-- came from, and the two must be equal. That is not bureaucracy: it is the
-- only property that makes the books self-checking. If the trial balance
-- balances, no entry has been half-recorded — and if it does not, something is
-- wrong and you are told, rather than finding out from an accountant in March.
--
-- ---------------------------------------------------------------------------
-- CASH BASIS (the owner's choice, and it is recorded here because it changes
-- how every number reads)
--
-- A sale is revenue WHEN THE MONEY ARRIVES, not when the order is placed.
--   * KNET and T-Pay  — at checkout, when the bank confirms.
--   * Cash on delivery — when the courier hands the money over, which is the
--                        `cod_paid` route in admin.php, days later.
--
-- So an unpaid COD order is not revenue and is not in these books at all.
-- It is a real commitment, and it is visible on the Orders screen, but it is
-- not money and the ledger does not pretend otherwise. The consequence worth
-- stating plainly: a month with many COD orders still out for delivery will
-- look thinner here than it felt. That is cash basis working, not a bug.
--
-- The alternative — accrual — recognises the sale on delivery and carries what
-- is owed in a receivables account. It is more correct under IFRS and it is a
-- bigger machine: something has to age the receivable and somebody has to
-- chase it. If the shop ever wants it, the ledger below does not need to
-- change; only the posting rules do.
--
-- ---------------------------------------------------------------------------
-- MONEY IS INTEGER FILS EVERYWHERE
--
-- decimal(12,3) in the columns because KWD has exactly three decimal places,
-- and integer fils in every PHP calculation — store_fils()/store_kwd(), the
-- same rule the pricing code has always followed. No float ever touches a
-- figure in this file. A rounding error in a shop's ledger is not a cosmetic
-- problem: it is a trial balance that does not balance, and then nobody trusts
-- any of it.
--
-- decimal(12,3) rather than the (10,3) used for an order: an order is one
-- basket and 10 digits is ample, but an account BALANCE accumulates for years.
-- (10,3) tops out at 9,999,999.999 KWD, which is not a limit a growing shop
-- should ever meet in a column that was cheap to widen at the start.

set names utf8mb4;

-- ------------------------------------------------------------- the accounts
--
-- The chart of accounts. Five types, and the type is what decides whether a
-- debit increases the account or decreases it — the one piece of accounting
-- that has to be right for everything else to follow.
--
--   asset, expense           normal balance DEBIT   (debit +, credit -)
--   liability, equity, revenue  normal balance CREDIT  (credit +, debit -)
--
-- `normal_side` is stored rather than derived from `type` even though it is
-- fully determined by it. It is read on every single line of every report, and
-- a five-way CASE repeated across a dozen queries is a five-way CASE that will
-- eventually be written wrong in one of them.
create table if not exists accounts (
  id        int unsigned auto_increment primary key,
  -- The code IS the ordering and the identity people speak in. 4000 is sales
  -- in every set of books anyone in the shop has seen before.
  code      varchar(10)  not null unique,
  name_en   varchar(80)  not null,
  name_ar   varchar(80)  not null,
  type      varchar(10)  not null,
  normal_side varchar(6) not null,
  -- A system account is one the POSTING RULES name directly — the sales
  -- account an order credits, the clearing account KNET debits. It cannot be
  -- deleted or have its code changed, because a rule in accounting.php looks
  -- it up by that code and would otherwise fail on a live shop at the moment
  -- of a payment. Accounts the owner adds for their own expenses are not
  -- system accounts and can be renamed or retired freely.
  is_system tinyint(1)   not null default 0,
  active    tinyint(1)   not null default 1,
  created_at timestamp   not null default current_timestamp,
  constraint accounts_type_ck check (type in ('asset','liability','equity','revenue','expense')),
  constraint accounts_side_ck check (normal_side in ('debit','credit'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- -------------------------------------------------------------- the journal
--
-- One row per EVENT. The lines below carry the money; this carries what
-- happened, when, and what caused it.
create table if not exists journal_entries (
  id         int unsigned auto_increment primary key,
  -- The date the event belongs to, which is not always the date the row was
  -- written: a COD payment recorded on Thursday for money taken on Tuesday
  -- belongs to Tuesday. Date, not datetime — a ledger is kept in days.
  entry_date date         not null,
  memo       varchar(200) not null default '',

  -- WHAT CAUSED THIS, and the reason the pair is unique.
  --
  -- `source` is 'order' for an automatic posting, 'manual' for something a
  -- person typed, 'system' for an opening balance or a period close.
  -- `source_ref` identifies it within that source, and `kind` separates two
  -- postings from the SAME cause — an order produces both a sale and a cost of
  -- goods entry, and they are different entries about one order.
  --
  -- The unique key is the idempotency guarantee, and it is the single most
  -- important line in this file. A payment callback can and does fire twice:
  -- the bank retries, the customer refreshes the return page, an admin marks a
  -- COD order paid that a colleague already marked. Without this, the second
  -- one posts a second set of revenue and the books silently overstate the
  -- shop's takings. With it, the insert fails and the posting code treats that
  -- failure as "already done", which is exactly what it is.
  source     varchar(10)  not null default 'manual',
  source_ref varchar(40)  null,
  kind       varchar(20)  null,

  -- Reversals, and why nothing here is ever deleted or edited.
  --
  -- A ledger's value is that it is a record of what was believed at the time.
  -- Editing a posted entry destroys that, and it is also how a shop loses the
  -- ability to explain a number to anyone. A mistake is corrected by posting
  -- its mirror image and pointing the two at each other: both remain, they sum
  -- to nothing, and the history says what happened and that it was undone.
  reverses_id int unsigned null,
  reversed_by_id int unsigned null,

  -- Who. Null for an automatic posting, which is itself informative.
  created_by varchar(120) null,
  created_at timestamp    not null default current_timestamp,

  unique key uq_journal_source (source, source_ref, kind),
  key idx_journal_date (entry_date),
  constraint journal_source_ck check (source in ('order','manual','system')),
  constraint fk_journal_reverses foreign key (reverses_id) references journal_entries (id)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- the lines
--
-- Two or more per entry, and they must sum equal on both sides.
create table if not exists journal_lines (
  id         int unsigned auto_increment primary key,
  entry_id   int unsigned not null,
  account_id int unsigned not null,
  -- A line is a debit OR a credit, never both and never neither. Stored as two
  -- columns rather than one signed amount plus a side flag, because that is
  -- how every report reads them and how every accountant reads them; the check
  -- below is what keeps the pair honest.
  debit      decimal(12,3) not null default 0,
  credit     decimal(12,3) not null default 0,
  memo       varchar(200)  not null default '',

  constraint fk_lines_entry   foreign key (entry_id)   references journal_entries (id) on delete cascade,
  constraint fk_lines_account foreign key (account_id) references accounts (id),
  -- Exactly one side, and it must be positive. A negative debit is a credit
  -- written by somebody who has confused themselves, and allowing it makes
  -- every report's arithmetic depend on nobody having done so.
  constraint lines_one_side_ck check (
    (debit > 0 and credit = 0) or (credit > 0 and debit = 0)
  ),
  key idx_lines_account (account_id),
  key idx_lines_entry (entry_id)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- THE BALANCE RULE IS NOT HERE, AND CANNOT BE.
--
-- "Debits equal credits for each entry" is a constraint across rows, and no
-- MySQL CHECK can see more than the row it is on. A trigger could, but this
-- schema deliberately has none — the fulfilment queue's docs claimed a trigger
-- for months that a schema check later found did not exist, and a rule nobody
-- can see is worse than one written down.
--
-- So it is enforced in PHP, in acc_post(), inside the same transaction that
-- writes the lines: the entry is rolled back if the two sides differ by a
-- single fils. accounting-test.mjs then proves the property from the outside —
-- after every kind of activity the suite can generate, sum(debit) = sum(credit)
-- across the whole ledger, and assets = liabilities + equity.

-- ------------------------------------------------------- the chart, seeded
--
-- `insert ignore` on the unique code, so re-running this file changes nothing
-- and an owner who has renamed an account keeps their name.
--
-- The codes follow the convention every bookkeeper expects, because the point
-- of a convention is that nobody has to be taught it:
--   1xxx assets   2xxx liabilities   3xxx equity   4xxx revenue   5xxx-6xxx expenses
insert ignore into accounts (code, name_en, name_ar, type, normal_side, is_system) values
  -- Assets ------------------------------------------------------------------
  ('1000', 'Cash on hand',        'النقد في الصندوق',   'asset', 'debit', 1),
  -- Why KNET and T-Pay have their own accounts rather than going straight to
  -- the bank: the customer pays on Sunday and the bank credits the shop on
  -- Tuesday, minus a fee. Between those two moments the money is real and is
  -- not in the bank. A clearing account is where it sits, and the balance of
  -- that account is the answer to "how much is the gateway holding right now"
  -- — which is a question the shop will ask, and which a single bank account
  -- cannot answer.
  ('1010', 'KNET clearing',       'كي نت - تحت التحصيل', 'asset', 'debit', 1),
  ('1020', 'T-Pay clearing',      'تي باي - تحت التحصيل','asset', 'debit', 1),
  ('1100', 'Bank account',        'الحساب البنكي',      'asset', 'debit', 1),
  ('1200', 'Inventory',           'المخزون',            'asset', 'debit', 1),

  -- Liabilities --------------------------------------------------------------
  ('2000', 'Accounts payable',    'الذمم الدائنة',      'liability', 'credit', 1),

  -- Equity -------------------------------------------------------------------
  ('3000', "Owner's capital",     'رأس المال',          'equity', 'credit', 1),
  ('3100', "Owner's drawings",    'مسحوبات المالك',     'equity', 'debit',  1),

  -- Revenue ------------------------------------------------------------------
  ('4000', 'Product sales',       'مبيعات المنتجات',    'revenue', 'credit', 1),
  ('4100', 'Delivery income',     'إيرادات التوصيل',    'revenue', 'credit', 1),
  -- CONTRA-REVENUE, and the reason it is an account rather than a smaller
  -- sales figure: a discount is a real cost with a real cause, and netting it
  -- off silently means nobody can ever answer "what did the promotions cost
  -- us". Its normal side is DEBIT even though it is a revenue account, which
  -- is exactly what contra means.
  ('4900', 'Discounts given',     'الخصومات الممنوحة',  'revenue', 'debit', 1),

  -- Expenses -----------------------------------------------------------------
  ('5000', 'Cost of goods sold',  'تكلفة البضاعة المباعة','expense', 'debit', 1),
  ('6000', 'Payment gateway fees','رسوم بوابة الدفع',   'expense', 'debit', 1),
  ('6100', 'Delivery cost',       'تكلفة التوصيل',      'expense', 'debit', 1),
  ('6200', 'Marketing',           'التسويق',            'expense', 'debit', 0),
  ('6300', 'Rent',                'الإيجار',            'expense', 'debit', 0),
  ('6400', 'Salaries',            'الرواتب',            'expense', 'debit', 0),
  ('6500', 'Hosting and software','الاستضافة والبرمجيات','expense', 'debit', 0),
  ('6900', 'Other expenses',      'مصروفات أخرى',       'expense', 'debit', 0);

-- ------------------------------------------------------------- the FX rate
--
-- Wholesale cost is held in AED (product_variants.cost_aed) because that is
-- the currency AHED invoices in. Cost of goods has to be posted in KWD, so a
-- rate is needed, and the owner chose one editable rate over a rate frozen
-- onto each order.
--
-- THE COST OF THAT CHOICE, STATED ONCE: changing the rate changes the COGS of
-- every order that has not yet posted, but NOT of any order already posted —
-- a journal entry is a record and is never recomputed. So past months do not
-- move, which is the property that actually matters, and the rate only ever
-- affects sales from the moment it is changed. The admin screen says this
-- where the field is, not only here.
--
-- 0.0817 is roughly 1 AED in KWD and is a placeholder. It is stored as a
-- string in the settings table like every other setting, and parsed with the
-- same care as a price.
-- One row, one JSON object — the shape every other setting in this table uses
-- (`name` + a JSON `value`), not a key/value pair. Written the other way
-- first, which would have inserted a row store_settings() cannot read: it
-- selects `name, value` and json_decode()s the value, so a bare string lands
-- as an empty array and the rate silently reads as zero. A COGS of nothing
-- posts happily and balances perfectly.
insert ignore into settings (name, value) values
  ('accounting', '{"aed_to_kwd":"0.0817","posting_enabled":false}');
