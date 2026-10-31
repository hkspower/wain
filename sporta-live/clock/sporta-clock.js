/* Smooth hands for the header clock - pairs with sporta-clock.css.
   Starts each hand's rotation animation at the current Asia/Kuwait phase
   (UTC+3, no daylight saving), so the hands sweep continuously instead of
   jumping each second. Re-syncs on every new clock element (React may
   re-mount the header) and whenever the tab becomes visible again. */
(function () {
  'use strict';
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var KUWAIT_OFFSET = 3 * 3600; // seconds; Kuwait does not observe DST

  function phaseSeconds() {
    var s = Date.now() / 1000 + KUWAIT_OFFSET;
    return {
      sec: s % 60,
      min: s % 3600,
      hour: s % 43200
    };
  }

  function sync(clock) {
    var p = phaseSeconds();
    clock.classList.remove('is-sweeping');
    clock.style.setProperty('--sporta-sec', (-p.sec).toFixed(3) + 's');
    clock.style.setProperty('--sporta-min', (-p.min).toFixed(3) + 's');
    clock.style.setProperty('--sporta-hour', (-p.hour).toFixed(3) + 's');
    void clock.offsetWidth; // restart the animations from this moment
    clock.classList.add('is-sweeping');
  }

  function syncAll() {
    var list = document.querySelectorAll('.clock');
    for (var i = 0; i < list.length; i++) sync(list[i]);
  }

  function watch() {
    syncAll();
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue;
          if (n.classList && n.classList.contains('clock')) sync(n);
          else if (n.querySelectorAll) {
            var inner = n.querySelectorAll('.clock');
            for (var k = 0; k < inner.length; k++) sync(inner[k]);
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) syncAll();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
