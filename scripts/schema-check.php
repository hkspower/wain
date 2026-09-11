<?php
/**
 * Schema drift: what the LIVE database is missing against a fresh install.
 *
 *   php /home/<user>/schema-check.php
 *
 * READ-ONLY, and that is not a preference. This file is fetched over plain
 * HTTP from a public repository by a cron job, so anything it can do, anyone
 * able to influence that fetch can do. It runs SELECTs against
 * information_schema and prints names. It creates nothing, alters nothing and
 * drops nothing — the repair is a separate, deliberate step.
 *
 * WHAT IT COMPARES AGAINST. The block below is every table and column a FRESH
 * install has, taken from importing database-sql/IMPORT-THIS-ONE.sql into an
 * empty database — 28 tables, 307 columns. So this answers one question: if
 * the shop were installed today, what would it have that the live database
 * does not?
 *
 * It deliberately does NOT report the other direction. A live database that
 * has MORE than a fresh install is normal — an older column nothing dropped,
 * something added by hand — and none of that stops today's code running.
 */

$EXPECTED = <<<'SCHEMA'
accounts:active,code,created_at,id,is_system,name_ar,name_en,normal_side,type
admin_users:created_at,email,email_otp_attempts,email_otp_enabled,email_otp_expires,email_otp_hash,email_otp_sent_at,failed_attempts,id,last_login_at,locked_until,password_hash,phone,totp_enabled,totp_last_step,totp_secret
assistant_outbox:attempts,created_at,handled_at,id,intent,lang,last_error,message,reply,sent_at
assistant_qa:active,a_ar,a_en,created_at,hits,id,last_hit_at,q_ar,q_en,updated_at
blocked_customers:blocked_by,created_at,id,phone,reason,scope
brands:active,created_at,id,logo,name_ar,name_en,slug,sort,updated_at
customer_mail_outbox:attempts,created_at,id,kind,lang,last_error,order_id,sent_at,to_email
discounts:active,category,code,created_at,ends_at,id,kind,label,min_order,starts_at,type,updated_at,usage_limit,used_count,value
fulfilment_outbox:attempts,created_at,id,kind,last_error,new_once,order_id,payload,sent_at
hero_slides:active,created_at,cta_href,cta_label_ar,cta_label_en,focal_x,focal_y,id,image,image_h,image_hash,image_w,sort,subtitle_ar,subtitle_en,title_ar,title_en,updated_at
journal_entries:created_at,created_by,entry_date,id,kind,memo,reversed_by_id,reverses_id,source,source_ref
journal_lines:account_id,credit,debit,entry_id,id,memo
orders:amount,cbk_authcode,cbk_message,cbk_paymentid,cbk_paytype,cbk_receipt,cbk_reference,cbk_status,cbk_transaction,created_at,customer_area,customer_block,customer_building,customer_email,customer_flat,customer_floor,customer_governorate,customer_lang,customer_name,customer_note,customer_phone,customer_street,delivery_fee,discount_amount,discount_code,discount_label,fulfilled_at,fulfilment_status,id,paid_at,payment_method,payment_status,pay_attempt,referrer_host,stock_claimed,stock_released,subtotal,track_id,utm_campaign,utm_medium,utm_source
order_items:fit,id,name_ar,name_en,order_id,product_id,qty,size,unit_price
products:active,brand_slug,category,created_at,desc_ar,desc_en,featured,featured_sort,id,image,images,name_ar,name_en,no_exchange,price,sale_ends_at,sale_price,sale_starts_at,slug
product_images:created_at,id,image,image_h,image_hash,image_w,slug,sort
product_variants:cost_aed,size,sku,slug,stock
push_outbox:attempts,body,created_at,id,kind,last_error,order_id,sent_at,title,url
push_subscriptions:auth,created_at,endpoint,endpoint_hash,id,label,last_error,last_ok_at,p256dh
rate_limit:bucket_key,hits,window_start
return_requests:created_at,decided_at,id,kind,lang,order_id,phone,reason,ref,staff_note,status
return_request_items:id,order_item_id,qty,request_id,want_size
reviews:comment,created_at,id,lang,order_id,published,rating,reward_code
settings:name,updated_at,value
size_advice_log:chest_cm,confidence,created_at,fit,height_cm,hip_cm,id,lang,outcome,prefers,size,slug,usual_size,waist_cm,weight_kg
size_charts:chart,chest_max,chest_min,hip_max,hip_min,id,is_default,length_cm,size,sort,waist_max,waist_min
wallet_passes:device_id,id,issued_at,kind,name,phone,points_at_issue,push_token,serial,updated_at
whatsapp_outbox:attempts,created_at,id,kind,lang,last_error,order_id,payload,sent_at,template,to_e164,wa_message_id
SCHEMA;

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { echo "DRIFT config unreadable\n"; exit; }

try {
    $pdo = new PDO(
        "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 10]
    );
} catch (Throwable $e) { echo "DRIFT db unreachable\n"; exit; }

// What is actually there.
$live = [];
$q = $pdo->prepare(
    'select table_name, column_name from information_schema.columns where table_schema = ?'
);
$q->execute([$cfg['db_name']]);
foreach ($q->fetchAll(PDO::FETCH_NUM) as [$t, $c]) $live[$t][$c] = true;

$missingTables = [];
$missingCols   = [];
foreach (explode("\n", trim($EXPECTED)) as $line) {
    [$table, $cols] = explode(':', $line, 2);
    if (!isset($live[$table])) { $missingTables[] = $table; continue; }
    foreach (explode(',', $cols) as $col) {
        if (!isset($live[$table][$col])) $missingCols[] = "$table.$col";
    }
}

echo 'DRIFT tables=' . count($live) . '/' . count(explode("\n", trim($EXPECTED)))
   . ' missingTables=' . (count($missingTables) ? implode(',', $missingTables) : 'none')
   . ' missingCols=' . (count($missingCols) ? implode(',', array_slice($missingCols, 0, 25)) : 'none')
   . "\n";
