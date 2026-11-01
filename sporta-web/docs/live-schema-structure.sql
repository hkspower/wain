-- Live table STRUCTURE only, extracted from the production dump of 2026-11-01.
-- No row data. Generated; do not edit by hand. Source for reconciling schema.mysql.sql.

CREATE TABLE `accounts` (
  `id` int(10) UNSIGNED NOT NULL,
  `code` varchar(10) NOT NULL,
  `name_en` varchar(80) NOT NULL,
  `name_ar` varchar(80) NOT NULL,
  `type` varchar(10) NOT NULL,
  `normal_side` varchar(6) NOT NULL,
  `is_system` tinyint(1) NOT NULL DEFAULT 0,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ;

CREATE TABLE `admin_audit_log` (
  `id` int(10) UNSIGNED NOT NULL,
  `admin_id` int(10) UNSIGNED DEFAULT NULL,
  `admin_email` varchar(120) NOT NULL,
  `route` varchar(64) NOT NULL,
  `status_code` smallint(5) UNSIGNED NOT NULL,
  `summary` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `admin_devices` (
  `id` int(10) UNSIGNED NOT NULL,
  `admin_id` int(10) UNSIGNED NOT NULL,
  `token_hash` char(64) NOT NULL,
  `pass_hash` varchar(255) NOT NULL,
  `label` varchar(80) NOT NULL DEFAULT '',
  `failed` tinyint(3) UNSIGNED NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_used_at` timestamp NULL DEFAULT NULL,
  `expires_at` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `admin_ip_geo` (
  `ip` varchar(45) NOT NULL,
  `country` varchar(2) DEFAULT NULL,
  `country_name` varchar(80) DEFAULT NULL,
  `looked_up_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `admin_known_ips` (
  `admin_id` int(10) UNSIGNED NOT NULL,
  `ip` varchar(45) NOT NULL,
  `first_seen` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_seen` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `admin_login_log` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `at` timestamp NOT NULL DEFAULT current_timestamp(),
  `admin_id` int(10) UNSIGNED DEFAULT NULL,
  `email` varchar(190) DEFAULT NULL,
  `method` varchar(16) NOT NULL,
  `result` varchar(40) NOT NULL,
  `ip` varchar(45) NOT NULL,
  `country` varchar(2) DEFAULT NULL,
  `country_name` varchar(80) DEFAULT NULL,
  `new_ip` tinyint(1) NOT NULL DEFAULT 0,
  `agent` varchar(160) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `admin_passkeys` (
  `id` int(10) UNSIGNED NOT NULL,
  `admin_id` int(10) UNSIGNED NOT NULL,
  `credential_id` varbinary(400) NOT NULL,
  `public_key` blob NOT NULL,
  `alg` int(11) NOT NULL,
  `sign_count` bigint(20) UNSIGNED NOT NULL DEFAULT 0,
  `label` varchar(60) DEFAULT NULL,
  `transports` varchar(80) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_used_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `admin_password_resets` (
  `admin_id` int(10) UNSIGNED NOT NULL,
  `code_hash` varchar(255) NOT NULL,
  `attempts` tinyint(3) UNSIGNED NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `expires_at` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `admin_sessions` (
  `id` int(10) UNSIGNED NOT NULL,
  `sid_hash` char(64) NOT NULL,
  `admin_id` int(10) UNSIGNED NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_seen` timestamp NOT NULL DEFAULT current_timestamp(),
  `ip` varchar(45) DEFAULT NULL,
  `agent` varchar(200) DEFAULT NULL,
  `method` varchar(16) NOT NULL DEFAULT 'password',
  `revoked_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `admin_users` (
  `id` int(10) UNSIGNED NOT NULL,
  `email` varchar(120) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `failed_attempts` int(11) NOT NULL DEFAULT 0,
  `locked_until` timestamp NULL DEFAULT NULL,
  `last_login_at` timestamp NULL DEFAULT NULL,
  `totp_secret` varchar(64) DEFAULT NULL,
  `totp_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `totp_last_step` bigint(20) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `email_otp_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `email_otp_hash` char(64) DEFAULT NULL,
  `email_otp_expires` timestamp NULL DEFAULT NULL,
  `email_otp_sent_at` timestamp NULL DEFAULT NULL,
  `email_otp_attempts` int(11) NOT NULL DEFAULT 0,
  `must_change_password` tinyint(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `assistant_outbox` (
  `id` int(10) UNSIGNED NOT NULL,
  `intent` varchar(24) NOT NULL,
  `lang` varchar(2) NOT NULL DEFAULT 'ar',
  `message` varchar(500) NOT NULL,
  `reply` varchar(1000) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `sent_at` timestamp NULL DEFAULT NULL,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `last_error` varchar(500) DEFAULT NULL,
  `handled_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `assistant_qa` (
  `id` int(10) UNSIGNED NOT NULL,
  `q_ar` varchar(200) NOT NULL DEFAULT '',
  `q_en` varchar(200) NOT NULL DEFAULT '',
  `a_ar` varchar(1000) NOT NULL,
  `a_en` varchar(1000) NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `hits` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `last_hit_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `blocked_customers` (
  `id` int(10) UNSIGNED NOT NULL,
  `phone` varchar(15) NOT NULL,
  `scope` varchar(3) NOT NULL DEFAULT 'cod',
  `reason` varchar(200) DEFAULT NULL,
  `blocked_by` varchar(120) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ;

CREATE TABLE `brands` (
  `id` int(10) UNSIGNED NOT NULL,
  `slug` varchar(80) NOT NULL,
  `name_en` varchar(80) NOT NULL,
  `name_ar` varchar(80) NOT NULL,
  `logo` mediumtext DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `sort` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `category_art` (
  `tile` varchar(16) NOT NULL,
  `variant` varchar(16) NOT NULL,
  `fmt` varchar(4) NOT NULL,
  `bytes` mediumblob NOT NULL,
  `etag` char(32) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ;

CREATE TABLE `customers` (
  `id` int(10) UNSIGNED NOT NULL,
  `email` varchar(190) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `name` varchar(120) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `verified_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_seen_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `customer_login_codes` (
  `id` int(10) UNSIGNED NOT NULL,
  `email` varchar(190) NOT NULL,
  `code_hash` char(64) NOT NULL,
  `attempts` tinyint(3) UNSIGNED NOT NULL DEFAULT 0,
  `expires_at` timestamp NOT NULL,
  `used_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `customer_mail_outbox` (
  `id` int(10) UNSIGNED NOT NULL,
  `order_id` int(10) UNSIGNED NOT NULL,
  `kind` varchar(24) NOT NULL DEFAULT 'received',
  `to_email` varchar(120) NOT NULL,
  `lang` varchar(2) NOT NULL DEFAULT 'ar',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `sent_at` timestamp NULL DEFAULT NULL,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `last_error` varchar(500) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `customer_notes` (
  `phone` varchar(15) NOT NULL,
  `note` text DEFAULT NULL,
  `tags` varchar(400) NOT NULL DEFAULT '',
  `updated_by` varchar(190) DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `customer_passkeys` (
  `id` int(10) UNSIGNED NOT NULL,
  `customer_id` int(10) UNSIGNED NOT NULL,
  `credential_id` varbinary(400) NOT NULL,
  `public_key` text NOT NULL,
  `alg` int(11) NOT NULL,
  `sign_count` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `label` varchar(60) DEFAULT NULL,
  `transports` varchar(80) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_used_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `discounts` (
  `id` int(10) UNSIGNED NOT NULL,
  `kind` varchar(6) NOT NULL DEFAULT 'code',
  `code` varchar(24) DEFAULT NULL,
  `label` varchar(80) NOT NULL,
  `type` varchar(8) NOT NULL DEFAULT 'percent',
  `value` decimal(10,3) NOT NULL,
  `min_order` decimal(10,3) NOT NULL DEFAULT 0.000,
  `category` varchar(40) DEFAULT NULL,
  `starts_at` datetime DEFAULT NULL,
  `ends_at` datetime DEFAULT NULL,
  `usage_limit` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `used_count` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ;

CREATE TABLE `fulfilment_outbox` (
  `id` int(10) UNSIGNED NOT NULL,
  `order_id` int(10) UNSIGNED NOT NULL,
  `kind` varchar(10) NOT NULL,
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`payload`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `sent_at` timestamp NULL DEFAULT NULL,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `last_error` varchar(500) DEFAULT NULL,
  `new_once` int(10) UNSIGNED GENERATED ALWAYS AS (case when `kind` = 'new' then `order_id` else NULL end) STORED
) ;

CREATE TABLE `hero_slides` (
  `id` int(10) UNSIGNED NOT NULL,
  `sort` int(11) NOT NULL DEFAULT 0,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `title_en` varchar(120) DEFAULT NULL,
  `title_ar` varchar(120) DEFAULT NULL,
  `subtitle_en` varchar(200) DEFAULT NULL,
  `subtitle_ar` varchar(200) DEFAULT NULL,
  `cta_label_en` varchar(40) DEFAULT NULL,
  `cta_label_ar` varchar(40) DEFAULT NULL,
  `cta_href` varchar(200) DEFAULT NULL,
  `image` longtext DEFAULT NULL,
  `image_hash` char(64) DEFAULT NULL,
  `image_w` int(11) DEFAULT NULL,
  `image_h` int(11) DEFAULT NULL,
  `focal_x` tinyint(3) UNSIGNED NOT NULL DEFAULT 50,
  `focal_y` tinyint(3) UNSIGNED NOT NULL DEFAULT 50,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `image_mobile` longtext DEFAULT NULL,
  `image_mobile_hash` char(64) DEFAULT NULL,
  `image_mobile_w` int(11) DEFAULT NULL,
  `image_mobile_h` int(11) DEFAULT NULL
) ;

CREATE TABLE `home_banner` (
  `id` tinyint(4) NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 0,
  `product` varchar(64) DEFAULT NULL,
  `kicker_en` varchar(60) NOT NULL DEFAULT '',
  `kicker_ar` varchar(60) NOT NULL DEFAULT '',
  `title_en` varchar(90) NOT NULL DEFAULT '',
  `title_ar` varchar(90) NOT NULL DEFAULT '',
  `button_en` varchar(30) NOT NULL DEFAULT '',
  `button_ar` varchar(30) NOT NULL DEFAULT '',
  `href` varchar(200) NOT NULL DEFAULT '',
  `image` mediumblob DEFAULT NULL,
  `image_type` varchar(10) DEFAULT NULL,
  `image_w` int(11) DEFAULT NULL,
  `image_h` int(11) DEFAULT NULL,
  `etag` char(32) DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ;

CREATE TABLE `journal_entries` (
  `id` int(10) UNSIGNED NOT NULL,
  `entry_date` date NOT NULL,
  `memo` varchar(200) NOT NULL DEFAULT '',
  `source` varchar(10) NOT NULL DEFAULT 'manual',
  `source_ref` varchar(40) DEFAULT NULL,
  `kind` varchar(20) DEFAULT NULL,
  `reverses_id` int(10) UNSIGNED DEFAULT NULL,
  `reversed_by_id` int(10) UNSIGNED DEFAULT NULL,
  `created_by` varchar(120) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ;

CREATE TABLE `journal_lines` (
  `id` int(10) UNSIGNED NOT NULL,
  `entry_id` int(10) UNSIGNED NOT NULL,
  `account_id` int(10) UNSIGNED NOT NULL,
  `debit` decimal(12,3) NOT NULL DEFAULT 0.000,
  `credit` decimal(12,3) NOT NULL DEFAULT 0.000,
  `memo` varchar(200) NOT NULL DEFAULT ''
) ;

CREATE TABLE `orders` (
  `id` int(10) UNSIGNED NOT NULL,
  `track_id` varchar(30) NOT NULL,
  `amount` decimal(10,3) NOT NULL DEFAULT 0.000,
  `subtotal` decimal(10,3) NOT NULL DEFAULT 0.000,
  `discount_amount` decimal(10,3) NOT NULL DEFAULT 0.000,
  `delivery_fee` decimal(10,3) NOT NULL DEFAULT 0.000,
  `discount_code` varchar(24) DEFAULT NULL,
  `discount_label` varchar(200) DEFAULT NULL,
  `payment_status` varchar(10) NOT NULL DEFAULT 'pending',
  `payment_method` varchar(10) NOT NULL DEFAULT 'knet',
  `fulfilment_status` varchar(12) NOT NULL DEFAULT 'unfulfilled',
  `cbk_status` varchar(30) DEFAULT NULL,
  `pay_attempt` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `cbk_message` varchar(200) DEFAULT NULL,
  `cbk_paymentid` varchar(60) DEFAULT NULL,
  `cbk_transaction` varchar(60) DEFAULT NULL,
  `cbk_authcode` varchar(30) DEFAULT NULL,
  `cbk_reference` varchar(60) DEFAULT NULL,
  `cbk_receipt` varchar(60) DEFAULT NULL,
  `cbk_paytype` varchar(20) DEFAULT NULL,
  `customer_name` varchar(80) DEFAULT NULL,
  `customer_phone` varchar(15) DEFAULT NULL,
  `customer_email` varchar(120) DEFAULT NULL,
  `customer_governorate` varchar(20) DEFAULT NULL,
  `customer_area` varchar(60) DEFAULT NULL,
  `customer_block` varchar(12) DEFAULT NULL,
  `customer_street` varchar(40) DEFAULT NULL,
  `customer_building` varchar(24) DEFAULT NULL,
  `customer_floor` varchar(16) DEFAULT NULL,
  `customer_flat` varchar(16) DEFAULT NULL,
  `customer_note` varchar(280) DEFAULT NULL,
  `customer_lang` varchar(2) DEFAULT NULL,
  `utm_source` varchar(60) DEFAULT NULL,
  `utm_medium` varchar(60) DEFAULT NULL,
  `utm_campaign` varchar(80) DEFAULT NULL,
  `referrer_host` varchar(120) DEFAULT NULL,
  `paid_at` timestamp NULL DEFAULT NULL,
  `fulfilled_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `stock_claimed` tinyint(1) NOT NULL DEFAULT 0,
  `stock_released` tinyint(1) NOT NULL DEFAULT 0,
  `customer_id` int(10) UNSIGNED DEFAULT NULL,
  `packed_at` timestamp NULL DEFAULT NULL,
  `shipped_at` timestamp NULL DEFAULT NULL,
  `courier` varchar(24) DEFAULT NULL,
  `courier_ref` varchar(80) DEFAULT NULL
) ;

CREATE TABLE `order_items` (
  `id` int(10) UNSIGNED NOT NULL,
  `order_id` int(10) UNSIGNED NOT NULL,
  `product_id` int(10) UNSIGNED NOT NULL,
  `name_en` varchar(120) DEFAULT NULL,
  `name_ar` varchar(120) DEFAULT NULL,
  `qty` int(11) NOT NULL,
  `unit_price` decimal(10,3) NOT NULL DEFAULT 0.000,
  `size` varchar(4) DEFAULT NULL,
  `fit` varchar(10) DEFAULT NULL
) ;

CREATE TABLE `order_location` (
  `order_id` int(10) UNSIGNED NOT NULL,
  `lat` decimal(9,6) NOT NULL,
  `lng` decimal(9,6) NOT NULL,
  `accuracy_m` int(10) UNSIGNED DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `products` (
  `id` int(10) UNSIGNED NOT NULL,
  `slug` varchar(80) NOT NULL,
  `name_en` varchar(160) NOT NULL,
  `name_ar` varchar(160) NOT NULL,
  `desc_en` text DEFAULT NULL,
  `desc_ar` text DEFAULT NULL,
  `price` decimal(10,3) NOT NULL,
  `sale_price` decimal(10,3) DEFAULT NULL,
  `sale_starts_at` datetime DEFAULT NULL,
  `sale_ends_at` datetime DEFAULT NULL,
  `category` varchar(40) DEFAULT NULL,
  `brand_slug` varchar(64) DEFAULT NULL,
  `image` varchar(500) DEFAULT NULL,
  `images` text DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `no_exchange` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `featured` tinyint(1) NOT NULL DEFAULT 0,
  `featured_sort` int(11) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_attrs` (
  `slug` varchar(80) NOT NULL,
  `colour` varchar(32) DEFAULT NULL,
  `fits` varchar(120) DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_images` (
  `id` int(10) UNSIGNED NOT NULL,
  `slug` varchar(120) NOT NULL,
  `sort` int(11) NOT NULL DEFAULT 0,
  `image` longtext NOT NULL,
  `image_hash` char(64) NOT NULL,
  `image_w` int(11) DEFAULT NULL,
  `image_h` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE `product_image_thumbs` (
  `image_id` int(10) UNSIGNED NOT NULL,
  `w` smallint(6) NOT NULL,
  `type` varchar(8) NOT NULL,
  `bytes` mediumblob NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_seo` (
  `slug` varchar(64) NOT NULL,
  `title_en` varchar(70) NOT NULL DEFAULT '',
  `title_ar` varchar(70) NOT NULL DEFAULT '',
  `desc_en` varchar(200) NOT NULL DEFAULT '',
  `desc_ar` varchar(200) NOT NULL DEFAULT '',
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_variants` (
  `sku` varchar(30) NOT NULL,
  `slug` varchar(80) NOT NULL,
  `size` varchar(4) NOT NULL,
  `stock` int(11) NOT NULL DEFAULT 0,
  `cost_aed` decimal(10,2) DEFAULT NULL
) ;

CREATE TABLE `purchase_orders` (
  `id` int(10) UNSIGNED NOT NULL,
  `supplier_id` int(10) UNSIGNED DEFAULT NULL,
  `status` varchar(10) NOT NULL DEFAULT 'open',
  `note` varchar(300) DEFAULT NULL,
  `expected_on` date DEFAULT NULL,
  `created_by` varchar(80) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `received_at` timestamp NULL DEFAULT NULL
) ;

CREATE TABLE `purchase_order_items` (
  `id` int(10) UNSIGNED NOT NULL,
  `po_id` int(10) UNSIGNED NOT NULL,
  `sku` varchar(30) NOT NULL,
  `qty` int(10) UNSIGNED NOT NULL,
  `cost_aed` decimal(10,2) DEFAULT NULL
) ;

CREATE TABLE `push_outbox` (
  `id` int(10) UNSIGNED NOT NULL,
  `order_id` int(10) UNSIGNED DEFAULT NULL,
  `kind` varchar(24) NOT NULL DEFAULT 'new',
  `title` varchar(120) NOT NULL,
  `body` varchar(300) NOT NULL,
  `url` varchar(200) NOT NULL DEFAULT '/backends',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `sent_at` timestamp NULL DEFAULT NULL,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `last_error` varchar(500) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `push_subscriptions` (
  `id` int(10) UNSIGNED NOT NULL,
  `endpoint` varchar(500) NOT NULL,
  `endpoint_hash` char(64) NOT NULL,
  `p256dh` varchar(120) NOT NULL,
  `auth` varchar(40) NOT NULL,
  `label` varchar(60) NOT NULL DEFAULT '',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_ok_at` timestamp NULL DEFAULT NULL,
  `last_error` varchar(300) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `rate_bucket` (
  `bucket_key` char(32) NOT NULL,
  `tokens` double NOT NULL,
  `refilled_at` double NOT NULL,
  `allowed` tinyint(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `rate_limit` (
  `bucket_key` char(32) NOT NULL,
  `window_start` int(10) UNSIGNED NOT NULL,
  `hits` int(10) UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `return_requests` (
  `id` int(10) UNSIGNED NOT NULL,
  `ref` varchar(20) NOT NULL,
  `order_id` int(10) UNSIGNED NOT NULL,
  `kind` varchar(10) NOT NULL,
  `status` varchar(12) NOT NULL DEFAULT 'new',
  `reason` varchar(280) DEFAULT NULL,
  `lang` varchar(2) NOT NULL DEFAULT 'ar',
  `phone` varchar(15) NOT NULL,
  `staff_note` varchar(280) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `decided_at` timestamp NULL DEFAULT NULL
) ;

CREATE TABLE `return_request_items` (
  `id` int(10) UNSIGNED NOT NULL,
  `request_id` int(10) UNSIGNED NOT NULL,
  `order_item_id` int(10) UNSIGNED NOT NULL,
  `qty` int(11) NOT NULL,
  `want_size` varchar(4) DEFAULT NULL
) ;

CREATE TABLE `reviews` (
  `id` int(10) UNSIGNED NOT NULL,
  `order_id` int(10) UNSIGNED NOT NULL,
  `rating` tinyint(3) UNSIGNED NOT NULL,
  `comment` varchar(1000) DEFAULT NULL,
  `lang` varchar(2) NOT NULL DEFAULT 'ar',
  `reward_code` varchar(24) DEFAULT NULL,
  `published` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ;

CREATE TABLE `seo_image` (
  `id` tinyint(4) NOT NULL,
  `image` mediumblob NOT NULL,
  `image_type` varchar(10) NOT NULL,
  `image_w` int(11) NOT NULL,
  `image_h` int(11) NOT NULL,
  `etag` char(32) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ;

CREATE TABLE `settings` (
  `name` varchar(40) NOT NULL,
  `value` text NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `site_images` (
  `name` varchar(24) NOT NULL,
  `fmt` varchar(4) NOT NULL,
  `bytes` mediumblob NOT NULL,
  `etag` char(32) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ;

CREATE TABLE `size_advice_log` (
  `id` int(10) UNSIGNED NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `slug` varchar(80) DEFAULT NULL,
  `lang` varchar(2) NOT NULL DEFAULT 'ar',
  `height_cm` smallint(5) UNSIGNED DEFAULT NULL,
  `weight_kg` smallint(5) UNSIGNED DEFAULT NULL,
  `chest_cm` smallint(5) UNSIGNED DEFAULT NULL,
  `waist_cm` smallint(5) UNSIGNED DEFAULT NULL,
  `hip_cm` smallint(5) UNSIGNED DEFAULT NULL,
  `usual_size` varchar(4) DEFAULT NULL,
  `prefers` varchar(10) DEFAULT NULL,
  `size` varchar(4) NOT NULL,
  `fit` varchar(10) DEFAULT NULL,
  `confidence` varchar(8) NOT NULL,
  `outcome` varchar(10) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `size_charts` (
  `id` int(10) UNSIGNED NOT NULL,
  `chart` varchar(24) NOT NULL,
  `size` varchar(4) NOT NULL,
  `chest_min` smallint(5) UNSIGNED NOT NULL,
  `chest_max` smallint(5) UNSIGNED NOT NULL,
  `waist_min` smallint(5) UNSIGNED NOT NULL,
  `waist_max` smallint(5) UNSIGNED NOT NULL,
  `hip_min` smallint(5) UNSIGNED DEFAULT NULL,
  `hip_max` smallint(5) UNSIGNED DEFAULT NULL,
  `length_cm` smallint(5) UNSIGNED DEFAULT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT 1,
  `sort` smallint(6) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `stock_log` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `at` timestamp NOT NULL DEFAULT current_timestamp(),
  `sku` varchar(30) NOT NULL,
  `slug` varchar(80) NOT NULL,
  `size` varchar(4) NOT NULL,
  `delta` int(11) NOT NULL,
  `stock_after` int(11) DEFAULT NULL,
  `reason` varchar(24) NOT NULL,
  `actor` varchar(80) DEFAULT NULL,
  `ref` varchar(40) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `suppliers` (
  `id` int(10) UNSIGNED NOT NULL,
  `name` varchar(80) NOT NULL,
  `contact` varchar(160) DEFAULT NULL,
  `lead_days` int(10) UNSIGNED NOT NULL DEFAULT 14,
  `note` varchar(300) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `variant_supplier` (
  `sku` varchar(30) NOT NULL,
  `supplier_id` int(10) UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `wallet_passes` (
  `id` int(10) UNSIGNED NOT NULL,
  `kind` varchar(10) NOT NULL DEFAULT 'loyalty',
  `serial` varchar(40) NOT NULL,
  `phone` varchar(16) DEFAULT NULL,
  `name` varchar(80) DEFAULT NULL,
  `points_at_issue` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `issued_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `device_id` varchar(64) DEFAULT NULL,
  `push_token` varchar(128) DEFAULT NULL,
  `auth_token` varchar(64) DEFAULT NULL
) ;

CREATE TABLE `wallet_registrations` (
  `device_id` varchar(64) NOT NULL,
  `serial` varchar(40) NOT NULL,
  `push_token` varchar(200) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `whatsapp_outbox` (
  `id` int(10) UNSIGNED NOT NULL,
  `order_id` int(10) UNSIGNED NOT NULL,
  `kind` varchar(12) NOT NULL,
  `to_e164` varchar(20) NOT NULL,
  `template` varchar(80) NOT NULL,
  `lang` varchar(5) NOT NULL DEFAULT 'ar',
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`payload`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `sent_at` timestamp NULL DEFAULT NULL,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `last_error` varchar(500) DEFAULT NULL,
  `wa_message_id` varchar(120) DEFAULT NULL
) ;

