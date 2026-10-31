-- Birthday on the customer account (additive, safe to re-run).
--   birthday            the customer's date of birth, or NULL
--   birthday_set_at     when it was last set; a gift is only sent once the date
--                       has been on file for 30 days, so typing "today" into the
--                       account page does not mint a code
--   birthday_sent_year  the year the last gift went out — one gift per year
alter table customer_accounts
  add column if not exists birthday           date     null default null,
  add column if not exists birthday_set_at    datetime null default null,
  add column if not exists birthday_sent_year smallint null default null;
