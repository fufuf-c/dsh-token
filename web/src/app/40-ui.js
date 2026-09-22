  var countUpValues = {};
  function countUp(el, to, fmt, key) {
    if (!el) return;
    to = Number(to) || 0;
    var k = key || el.id || 'anon';
    var from = countUpValues[k] != null ? countUpValues[k] : 0;
    if (reduceMotion() || Math.abs(to - from) < 1e-9) {
      el.textContent = fmt(to); el.__cv = to; countUpValues[k] = to; return;
    }
    countUpValues[k] = to;
    var t0 = performance.now(), dur = 750;
    function step(t) {
      var p = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (to - from) * e);
      el.__cv = from + (to - from) * e;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 2300);
  }
  var tipEl = null;
  function showTip(x, y, html) {
    if (!tipEl) tipEl = $('tip');
    tipEl.innerHTML = html;
    tipEl.hidden = false;
    var w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    var px = x + 14, py = y + 14;
    if (px + w > window.innerWidth - 8) px = x - w - 14;
    if (py + h > window.innerHeight - 8) py = y - h - 14;
    tipEl.style.left = Math.max(8, px) + 'px';
    tipEl.style.top = Math.max(8, py) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.hidden = true; }

  function bindChartPointer(cv, onMove, onLeave) {
    if (!cv) return;
    cv.style.touchAction = 'none';
    var prev = cv.__dtkPtr;
    if (prev) {
      cv.removeEventListener('pointermove', prev.move);
      cv.removeEventListener('pointerdown', prev.down);
      cv.removeEventListener('pointerup', prev.up);
      cv.removeEventListener('pointerleave', prev.leave);
      cv.removeEventListener('pointercancel', prev.cancel);
    }
    var active = false;
    var at = function (e) { return { x: e.clientX, y: e.clientY } }
    var move = function (e) {
      if (e.pointerType === 'touch' && !active) return 
      var p = at(e); onMove(p.x, p.y)
    }
    var down = function (e) {
      active = true
      try { cv.setPointerCapture(e.pointerId) } catch (err) {  }
      var p = at(e); onMove(p.x, p.y)
    }
    var up = function (e) {
      active = false
      try { cv.releasePointerCapture(e.pointerId) } catch (err) {  }
    }
    var leave = function () { active = false; if (onLeave) onLeave() }
    cv.addEventListener('pointermove', move)
    cv.addEventListener('pointerdown', down)
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointerleave', leave)
    cv.addEventListener('pointercancel', leave)
    cv.__dtkPtr = { move: move, down: down, up: up, leave: leave, cancel: leave }
  }

  function emptyHTML(title, sub) {
    return '<div class="empty">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-5 4 4 8-8"/><path d="M21 5v5h-5"/></svg>' +
      '<b>' + stringifyForHtml(title) + '</b><span>' + stringifyForHtml(sub == null ? '' : sub) + '</span></div>';
  }

  function setupCanvas(cv, cssH) {
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(120, cv.parentElement.clientWidth || cv.clientWidth || 640);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round((cssH || 200) * dpr);
    cv.style.height = (cssH || 200) + 'px';
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g: g, w: w, h: cssH || 200 };
  }
  function rr(g, x, y, w, h, r) {
    if (g.roundRect) { g.roundRect(x, y, w, h, r); return; }
    g.rect(x, y, w, h);
  }

  function drawAreaLine(g, n, xOf, yOf, rgb, box, opts) {
    if (!n) return;
    var base = 'rgba(' + rgb.join(',') + ',';
    var pad = box.pad;
    var grad = g.createLinearGradient(0, pad.t, 0, box.h - pad.b);
    grad.addColorStop(0, base + '.20)');
    grad.addColorStop(1, base + '.02)');
    
    g.beginPath();
    for (var i = 0; i < n; i++) { if (i === 0) g.moveTo(xOf(i), yOf(i)); else g.lineTo(xOf(i), yOf(i)); }
    g.lineTo(xOf(n - 1), box.h - pad.b);
    g.lineTo(xOf(0), box.h - pad.b);
    g.closePath();
    g.fillStyle = grad;
    g.fill();
    
    g.beginPath();
    for (var j = 0; j < n; j++) { if (j === 0) g.moveTo(xOf(j), yOf(j)); else g.lineTo(xOf(j), yOf(j)); }
    g.strokeStyle = base + '1)';
    g.lineWidth = (opts && opts.lineWidth) || 2.4;
    
    
    
    if (opts && opts.lineJoin) g.lineJoin = opts.lineJoin;
    g.stroke();
  }
  function hexRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [10, 132, 255];
  }
  function dotColor(total) {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var rgb = dark ? [10, 132, 255] : [0, 122, 255];
    if (total >= 1e7) return 'rgba(' + rgb.join(',') + ',1)';
    if (total >= 1e6) return 'rgba(' + rgb.join(',') + ',.62)';
    if (total >= 1e5) return 'rgba(' + rgb.join(',') + ',.38)';
    return 'rgba(142,142,147,.55)';
  }

  function segSync(seg) {
    if (!seg) return;
    var on = seg.querySelector('button.on');
    var t = seg.querySelector('.seg-thumb');
    if (!t) { t = document.createElement('span'); t.className = 'seg-thumb'; seg.insertBefore(t, seg.firstChild); }

    if (!on) { t.classList.add('hide'); return; }
    t.classList.remove('hide');
    var sr = seg.getBoundingClientRect(), br = on.getBoundingClientRect();
    if (!sr.width || !br.width) return;
    t.style.width = br.width + 'px';
    t.style.height = br.height + 'px';
    t.style.transform = 'translate(' + (br.left - sr.left) + 'px,' + (br.top - sr.top) + 'px)';
  }
  function segSyncAll(root) {
    (root || document).querySelectorAll('.seg').forEach(function (s) { segSync(s); });
  }
  function setSeg(segId, attr, val) {
    var seg = $(segId);
    if (!seg) return;
    seg.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute(attr) === val);
    });
    segSync(seg);
  }
