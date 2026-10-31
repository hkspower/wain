# Hero slide images — Oct 2026 refresh

The live slider (`hero_slides`, 7 active rows, 3200×1270) was all AI studio shots that repeated each other: two near-identical sprinters, two hands-on-hips poses, and mostly empty white backgrounds. These are the replacements.

Generated on ElevenLabs (flow "Sporta hero slides — Oct 2026", model `bytedance-seedream-5-pro`, custom size 3200×1270, so no crop is needed). Every subject sits on the right third, which leaves room for the headline on the left.

| Row | Status | Scene |
|---|---|---|
| 8 | kept | yellow-tank barbell (the owner's own brief) |
| 9 | **live 16:04Z** | Arab woman runner, Kuwait corniche at sunrise, Kuwait Towers behind |
| 2 | queued | Gulf basketball dunk, outdoor court at dusk |
| 3 | queued | woman, battle ropes, dark gym, orange key light |
| 5 | queued | sprinter leaving the blocks, golden hour ("Built to move") |
| 6 | queued | woman in a sports hijab, kettlebell swing, bright gym ("Strength, your way") |
| 7 | queued | man pushing a sled, moody gym ("Ready to train") |

"Queued" means the ElevenLabs free tier refused to start the take ("Free generations are busy"). Run those nodes again on the flow.

## Install procedure (as done for row 9)
1. Check the image for brand marks. Despite "no logos" in the prompt, slide 9 came back with a Nike swoosh on the chest; it was blurred out (`-region 130x70+2180+372 -blur 0x14`).
2. Convert: `magick in.png -strip -quality 80 -define webp:method=6 out.webp` (row 9 came out at 98 kB).
3. Set `image='data:image/webp;base64,…'`, `image_hash=sha256(that exact string)` (same as `admin.php`), `image_w`/`image_h`, and `focal_x`/`focal_y`.
4. Backup taken first: `/docker/sporta/backups/claude-20261031T1610Z-hero/hero_slides.sql.gz` (all rows, before any change).

Staging files: `/docker/sporta/staging/hero-20261031/` on the VPS.
