# Ads → order: tagging campaigns so the shop can report on them

The shop records which campaign produced each order and shows it in
**/backends → Orders**, in a **Source** column beside the amount.

It can only do that if the ad's link says so. **An untagged ad produces orders
labelled "Direct"**, which is indistinguishable from someone typing the address
— so the money is spent and the report cannot say what it bought.

---

## What to put in the ad link

Add `utm_source`, and ideally `utm_medium` and `utm_campaign`, to the URL in
the ad:

```
https://www.sporta.com.kw/product/sculpt-top-grey?utm_source=instagram&utm_medium=paid_social&utm_campaign=summer_sale
```

| Parameter | What to put | Example |
|---|---|---|
| `utm_source` | where the ad ran | `instagram`, `snapchat`, `tiktok`, `google` |
| `utm_medium` | what kind of placement | `paid_social`, `cpc`, `story`, `influencer` |
| `utm_campaign` | which campaign, in your own words | `summer_sale`, `eid_2026`, `ramadan_offers` |

**Be consistent with spelling.** `Instagram`, `instagram` and `insta` become
three rows in the report, and the campaign that "did nothing" is often the same
one under another name. Pick lowercase and stick to it.

**Link to the product, not the home page.** Someone who clicked an ad for a
jacket and lands on the home page has to find the jacket again, and most will
not. Every product page is a valid ad destination and keeps its campaign tags.

Meta, Google and TikTok can append their own click ids (`fbclid`, `gclid`).
Those are ignored on purpose — see below.

---

## What is recorded, and what is not

Recorded, on the order row:

| Column | From |
|---|---|
| `utm_source` / `utm_medium` / `utm_campaign` | the ad link |
| `referrer_host` | the site the visitor arrived from, **host only** |

`referrer_host` answers the organic half of the question: an order from
`instagram.com` with no campaign came from a post, not a paid ad, and those are
two different budgets.

**Deliberately not recorded: the click identifiers** (`fbclid`, `gclid`). They
are the most identifying part of an ad URL, they are long, and they are only
useful for uploading conversions back to the ad platform — which this shop does
not do. Storing personal-ish data for a feature nobody has built is how a
privacy policy becomes untrue.

---

## The rules it follows

**Last touch wins.** If someone arrives from an Instagram ad, wanders off, then
comes back from a Google ad and buys, **Google** is recorded. That matches how
the ad platforms report, so the shop's answer and the dashboard's answer do not
contradict each other.

**One visit, not for ever.** The campaign is remembered in `sessionStorage`, so
it lasts as long as the browser tab. An ad clicked in March must not still be
claiming credit for an order placed in June — that is worse than no
attribution, because it is confidently wrong.

**An internal click never clears it.** Only a genuinely new campaign replaces
the old one, so browsing between the ad and the checkout does not lose it.

**It can never cost a sale.** Attribution decides nothing about price, stock or
fulfilment. A 4 kB campaign label is truncated, a malformed one is dropped, and
the order goes through either way. This is asserted in `npm run test:native`.

---

## Reading the report

**/backends → Orders** shows the source per order. For totals, the columns are
plain SQL — in phpMyAdmin:

```sql
-- What each campaign earned, this month
select utm_source, utm_campaign,
       count(*)     as orders,
       sum(amount)  as kwd
  from orders
 where payment_status = 'paid'
   and created_at >= date_format(curdate(), '%Y-%m-01')
 group by utm_source, utm_campaign
 order by kwd desc;
```

Filter on `payment_status = 'paid'`. Counting unpaid orders makes a campaign
that attracts abandoned checkouts look like the best one you have.
