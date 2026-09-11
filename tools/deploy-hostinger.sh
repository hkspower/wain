#!/bin/sh
# نشر موقع موصول على استضافة Hostinger المشتركة.
#
# ── لماذا نصٌّ في المستودع لا أمرٌ في مهمّة مجدوَلة ──────────────────
# الرفع المباشر إلى الاستضافة محجوبٌ من بيئة الأتمتة، والطريق الباقي أن
# **يجلب الخادمُ المستودعَ بنفسه** (وهو عامّ) عبر مهمّة مجدوَلة. وحقل
# الأمر في تلك المهمّة محدود الطول — قِيس: أمرٌ من ٢٨٥ محرفًا يُرفض
# بـ٤٢٢ وأمرٌ من ٧٥ يُقبل. فلا يتّسع للنشر كلّه في سطر.
#
# والأهمّ أنّ أمرًا طويلًا في حقلٍ بعيد لا يُراجَع ولا يُختبَر ولا يُعرف
# بعد حينٍ ما فعل. فالنشر هنا، في المستودع، يُقرأ في المراجعة ويُجرَّب
# محلّيًا قبل أن يمسّ خادمًا.
#
# ── التشغيل ────────────────────────────────────────────────────────
#   sh deploy-hostinger.sh <git-ref> [docroot]
#
# ومن المهمّة المجدوَلة (السطر كلّه قصير فيتّسع له الحقل):
#   cd /tmp && curl -sLo d.sh https://raw.githubusercontent.com/hkspower/wain/<ref>/tools/deploy-hostinger.sh && sh d.sh <ref>
#
# ── ما يفعله وما لا يفعله ──────────────────────────────────────────
# ينسخ ملفّات الموقع فوق ما في الجذر، ويستبدل النطاق النموذجيّ بالنطاق
# الحقيقيّ كما تفعل أداة البناء بالضبط (إحلالٌ نصّيّ بحت).
#
# و**لا يحذف شيئًا**. فما كان على الخادم من إصدارٍ سابق يبقى، وهو الرجوع
# إن ساء الجديد. ومن أراد تنظيفه حذفه بيده بعد أن يطمئنّ.

set -e

REF="$1"
DOCROOT="${2:-/home/u130124229/domains/mawsoool.com/public_html}"
DOMAIN="mawsoool.com"
PLACEHOLDER="mawsool.com.kw"
WORK="/tmp/mawsool-deploy.$$"

[ -n "$REF" ] || { echo "خطأ: لا مرجع. الاستعمال: sh $0 <git-ref> [docroot]"; exit 2; }

echo "── موصول: نشر $REF ──"
echo "الجذر: $DOCROOT"

# الجذر يجب أن يكون قائمًا وأن يبدو جذر موقع — لا يُكتب في مكانٍ بالغلط
[ -d "$DOCROOT" ] || { echo "خطأ: الجذر غير موجود"; exit 3; }

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT INT TERM

mkdir -p "$WORK"
echo "· يجلب الأرشيف…"
curl -sfL -o "$WORK/src.tgz" "https://codeload.github.com/hkspower/wain/tar.gz/$REF" \
  || { echo "خطأ: تعذّر جلب الأرشيف — راجع المرجع والشبكة"; exit 4; }

tar -xzf "$WORK/src.tgz" -C "$WORK" --strip-components=1
SRC="$WORK/website"

# يُتحقَّق من المصدر **قبل** أن يُكتب حرفٌ في الجذر: مرجعٌ خاطئ أو أرشيفٌ
# ناقص يجب أن يقف هنا، لا أن يترك الموقع الحيّ نصفَ منشور.
for f in index.html site.css order.js robots.txt sitemap.xml; do
  [ -f "$SRC/$f" ] || { echo "خطأ: $f ليس في الأرشيف — لا شيء نُشر"; exit 5; }
done
[ -d "$SRC/assets" ] || { echo "خطأ: assets ليست في الأرشيف — لا شيء نُشر"; exit 5; }

echo "· ينسخ…"
cp -f "$SRC/index.html" "$SRC/site.css" "$SRC/order.js" "$SRC/robots.txt" "$SRC/sitemap.xml" "$DOCROOT/"
mkdir -p "$DOCROOT/assets"
cp -Rf "$SRC/assets/." "$DOCROOT/assets/"

# النطاق: إحلالٌ نصّيّ بحت، هو عينُ ما يفعله tools/build-release.mjs
#   before.split(PLACEHOLDER).join(DOMAIN)
echo "· يستبدل النطاق $PLACEHOLDER ← $DOMAIN"
cd "$DOCROOT"
sed -i "s|$PLACEHOLDER|$DOMAIN|g" index.html robots.txt order.js sitemap.xml

# ولا يبقى منه أثر — وإلّا فالصفحة تشير إلى نطاقٍ ليس لنا
if grep -l "$PLACEHOLDER" index.html robots.txt order.js sitemap.xml 2>/dev/null; then
  echo "تحذير: بقي ذكرٌ للنطاق النموذجيّ في الملفّات أعلاه"
fi

# بصمةٌ لكل ملفّ تُقارَن بالمحلّي — تثبُّتٌ بلا تنزيل
echo "── البصمات ──"
for f in index.html site.css order.js robots.txt sitemap.xml; do
  if command -v sha256sum >/dev/null 2>&1; then
    echo "  $(sha256sum "$f" | cut -c1-16)  $f"
  else
    echo "  $(wc -c < "$f") بايت  $f"
  fi
done

echo "DEPLOY-OK $REF"
