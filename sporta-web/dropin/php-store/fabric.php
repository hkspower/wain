<?php
/*
 * Fabric composition of a product: which materials it is made of, and optionally how much of each.
 *
 * STORAGE. One text column, products.fabric, holding the canonical form:
 *     "cotton:80,elastane:20"   materials with percentages (they add up to 100)
 *     "cotton,polyester"        materials without percentages
 *   or NULL for "not stated". At most four materials, so the value always fits varchar(160).
 *
 * THE PERCENT OPTION. Either every material carries a percentage and they add up to exactly 100, or none does. A
 * half-filled composition ("cotton 80, elastane" ) is refused, because the shopper would read the missing share as zero.
 *
 * THE LIST IS FIXED. The shop sells a known set of materials and the labels are written in both languages in the
 * storefront and the admin. A free-text field would let "Cotton", "cotton " and "COTTON" become three entries. Adding a
 * material is a change to STORE_FABRIC_MATERIALS here and to the two label maps in the add-ons.
 *
 * Rules are enforced here and nowhere else: the admin's form and the storefront only display what this file accepts.
 */

const STORE_FABRIC_MATERIALS = ['cotton', 'polyester', 'elastane', 'nylon', 'viscose', 'modal', 'wool', 'linen', 'bamboo'];
const STORE_FABRIC_MAX_ENTRIES = 4;

/**
 * Validates the list the admin sends: [{material: "cotton", percent: 80}, {material: "elastane", percent: 20}] or
 * [{material: "cotton"}, {material: "polyester"}]. An empty list clears the composition (returns null).
 * Returns the canonical string, or stops the request with a code the admin screen can name.
 */
function store_fabric_parse(mixed $value): ?string {
    if ($value === null) return null;
    if (!is_array($value) || !array_is_list($value)) store_fail('fabric_invalid');
    if (count($value) === 0) return null;
    if (count($value) > STORE_FABRIC_MAX_ENTRIES) store_fail('fabric_too_many');

    $seen = [];
    $withPercent = 0;
    $withoutPercent = 0;
    $parts = [];
    $sum = 0;
    foreach ($value as $entry) {
        if (!is_array($entry)) store_fail('fabric_invalid');
        $material = $entry['material'] ?? null;
        if (!is_string($material) || !in_array($material, STORE_FABRIC_MATERIALS, true)) store_fail('fabric_unknown_material');
        if (isset($seen[$material])) store_fail('fabric_duplicate');
        $seen[$material] = true;

        if (!array_key_exists('percent', $entry) || $entry['percent'] === null || $entry['percent'] === '') {
            $withoutPercent++;
            $parts[] = $material;
            continue;
        }
        $withPercent++;
        $p = $entry['percent'];
        if (is_string($p) && preg_match('/^[0-9]{1,3}$/D', $p)) $p = (int)$p;
        if (!is_int($p) || $p < 1 || $p > 100) store_fail('fabric_percent_invalid');
        $sum += $p;
        $parts[] = $material . ':' . $p;
    }
    // Both kinds in one composition, or a percentage that does not reach 100, is a half-filled entry and is refused.
    if ($withPercent > 0 && $withoutPercent > 0) store_fail('fabric_percent_partial');
    if ($withPercent > 0 && $sum !== 100) store_fail('fabric_percent_total');

    $canonical = implode(',', $parts);
    if (strlen($canonical) > 160) store_fail('fabric_invalid');
    return $canonical;
}

/**
 * Turns the stored text back into the list the admin and the storefront draw. Unknown materials (a value written by hand
 * in the database) are dropped rather than shown, so a bad row can never put an unlabelled word on a product page.
 * Returns null when nothing is stated.
 */
function store_fabric_decode(?string $stored): ?array {
    if ($stored === null || trim($stored) === '') return null;
    $out = [];
    foreach (explode(',', $stored) as $part) {
        $part = trim($part);
        if ($part === '') continue;
        $bits = explode(':', $part, 2);
        $material = strtolower(trim($bits[0]));
        if (!in_array($material, STORE_FABRIC_MATERIALS, true)) continue;
        $percent = null;
        if (isset($bits[1]) && preg_match('/^[0-9]{1,3}$/D', trim($bits[1]))) $percent = (int)trim($bits[1]);
        $out[] = ['material' => $material, 'percent' => $percent];
    }
    return $out ? $out : null;
}
