Sporta — brand images.  سبورتا — صور العلامات التجارية
=======================================================

One folder per brand. Put that brand's logo inside its own folder and the shop
picks it up — no rebuild, no upload tool, nothing to run afterwards.

    public_html/images/
        ahed/            AHED
        ate/             ATE
        eyesportwear/    Eyesportwear
        gymshark/        Gymshark
        nba/             NBA
        rheo/            RHEO
        sporta/          Sporta
        vanquish/        Vanquish

The folder names are the brand SLUGS, not the display names. That is how the
shop finds them: a product row says brand_slug = 'gymshark', and the server
looks in images/gymshark/. Renaming a folder disconnects it — if you need a new
brand, add it in /backends first and then make a folder with the slug it shows.


WHAT TO PUT IN
--------------

    logo.png     or  logo.webp  or  logo.jpg

That exact filename. The shop looks for those three, in that order, and uses
the first one it finds. Anything else in the folder is ignored — which means
you can keep the original artwork, a PSD, a bigger version, alongside it
without confusing anything.

  Size          about 400 px wide is plenty. It is displayed small, on a
                product page, beside the garment's name.
  Background    transparent PNG or WebP looks best — the shop has a light and
                a dark theme, and a logo baked onto a white square shows as a
                white box in the dark one.
  File size     keep it under 150 kB. It is served to every visitor who opens
                a product of that brand.


HOW TO ADD ONE
--------------

hPanel → File Manager → public_html → images → the brand's folder → Upload.
That is all. The next page load shows it.

You do NOT need to clear a cache. The shop builds the image's address from the
file's own size and timestamp, so a replaced logo is a different address and is
picked up at once, while the old one stays cached for the people who already
have it.


IF A BRAND ALSO HAS A LOGO IN /backends
---------------------------------------

The panel can store a logo in the database as well. If both exist, THE PANEL
WINS — the database is the deliberate choice someone made in the shop's own
tools, and a file left on disk should not quietly override it.

So if you upload a file here and nothing changes, check whether that brand
already has a logo set in /backends → Brands, and clear it there.


REMOVING ONE
------------

Delete the file. The brand goes back to showing no logo, which is what every
brand does today. Deleting the FOLDER is fine too — it is recreated the next
time anyone deploys, empty.
