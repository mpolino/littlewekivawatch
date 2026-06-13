/* Little Wekiva Watch — client-side data + logic. No build step. */
'use strict';

// ---- Constants (verified facts; do not re-derive) ----
var SITE = '02234990';
var POINT = '28.6716,-81.4131';
var BANK_HEIGHT = 10;            // ft, local depth at bank overtop (my property)
var GAGE_BASE = 23.41;           // gage height at ~0.5 ft local depth
var DEPTH_AT_BASE = 0.5;
var SLOPE = 1.146;               // local_depth = 0.5 + 1.146*(gage - 23.41)
var DEPTH_FLOOR = 0.5;           // reliable-measurement minimum; riverbed uneven below
var REFRESH_MS = 12 * 60 * 1000; // ~12 min auto-refresh
var FETCH_TIMEOUT_MS = 12000;    // abort a stuck USGS fetch after 12s

var ALERT_EVENTS = [
  'Hurricane Warning', 'Hurricane Watch',
  'Tropical Storm Warning', 'Tropical Storm Watch'
];

// Threshold ladder. Each band starts at minDepth (local). Picked by current depth.
// Colors map to CSS custom-property hex values.
var LADDER = [
  { minDepth: 0.0,  gage: 23.4, state: 'Normal',       color: '#2f8f5b' },
  { minDepth: 6.3,  gage: 28.5, state: 'Watch',        color: '#d9b21f', note: 'NWS minor flood' },
  { minDepth: 7.7,  gage: 29.7, state: 'Elevated',     color: '#e08a1e', note: 'Irma level' },
  { minDepth: 8.1,  gage: 30.0, state: 'Prep',         color: '#df6b14' },
  { minDepth: 9.3,  gage: 31.1, state: 'Record',       color: '#c8470f', note: 'Ian level' },
  { minDepth: 10.0, gage: 32.5, state: 'Bank overtop', color: '#b21f1f' }
];

// ---- Conversion ----
function gageToDepth(gage) {
  return DEPTH_AT_BASE + SLOPE * (gage - GAGE_BASE);
}

// Apply the 0.5 ft reliable-measurement floor to any displayed/plotted depth.
function floorDepth(depth) {
  return depth < DEPTH_FLOOR ? DEPTH_FLOOR : depth;
}

function bandForDepth(depth) {
  var band = LADDER[0];
  for (var i = 0; i < LADDER.length; i++) {
    if (depth >= LADDER[i].minDepth) band = LADDER[i];
  }
  return band;
}

// ---- DOM helpers ----
function $(id) { return document.getElementById(id); }

function fmtTime(iso) {
  try {
    var d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  } catch (e) { return ''; }
}

// ---- Render current reading ----
function renderCurrent(gage, dateTime) {
  var shown = floorDepth(gageToDepth(gage));
  var band = bandForDepth(shown);

  document.documentElement.style.setProperty('--state', band.color);

  $('depth-num').textContent = shown.toFixed(1);
  $('state-label').textContent = band.state + (band.note ? ' (' + band.note + ')' : '');

  var belowBank = BANK_HEIGHT - shown;
  if (shown >= BANK_HEIGHT) {
    $('below-bank').textContent = 'At or above bank top';
  } else {
    if (belowBank < 0) belowBank = 0;
    $('below-bank').textContent = belowBank.toFixed(1) + ' ft below bank top';
  }

  $('gage-ref').textContent = 'gage ' + Number(gage).toFixed(2) + ' ft';
  $('reading-time').textContent = dateTime ? 'as of ' + fmtTime(dateTime) : '';
  $('river-note').hidden = true;

  // highlight current band in ladder
  var lis = document.querySelectorAll('#ladder li');
  for (var i = 0; i < lis.length; i++) {
    lis[i].classList.toggle('current', lis[i].getAttribute('data-state') === band.state);
  }
}

// ---- Ladder render (static, once) ----
function renderLadder() {
  var ul = $('ladder');
  ul.innerHTML = '';
  for (var i = 0; i < LADDER.length; i++) {
    var b = LADDER[i];
    var li = document.createElement('li');
    li.setAttribute('data-state', b.state);

    var dot = document.createElement('span');
    dot.className = 'lad-dot';
    dot.style.background = b.color;

    var name = document.createElement('span');
    name.className = 'lad-name';
    name.textContent = b.state + (b.note ? ' — ' + b.note : '');

    var depthLbl = document.createElement('span');
    depthLbl.className = 'lad-depth';
    depthLbl.textContent = (i === 0 ? '<1' : '~' + b.minDepth) + ' ft';

    li.appendChild(dot);
    li.appendChild(name);
    li.appendChild(depthLbl);
    ul.appendChild(li);
  }
}

// ---- USGS fetch ----
function usgsUrl(period) {
  return 'https://nwis.waterservices.usgs.gov/nwis/iv/?sites=' + SITE +
    '&parameterCd=00065&format=json&period=' + period;
}

function parseUsgs(json) {
  // value.timeSeries[0].values[0].value[] -> [{value, dateTime}]
  var ts = json && json.value && json.value.timeSeries;
  if (!ts || !ts.length) return [];
  var vals = ts[0].values && ts[0].values[0] && ts[0].values[0].value;
  if (!vals) return [];
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var g = parseFloat(vals[i].value);
    if (isNaN(g) || g <= -999000) continue; // USGS no-data sentinel
    out.push({ gage: g, t: vals[i].dateTime });
  }
  return out;
}

// One USGS fetch attempt, aborted after FETCH_TIMEOUT_MS.
function fetchRiverOnce(period) {
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT_MS) : null;
  var opts = { cache: 'no-store' };
  if (ctrl) opts.signal = ctrl.signal;
  return fetch(usgsUrl(period), opts)
    .then(function (r) {
      if (!r.ok) throw new Error('usgs ' + r.status);
      return r.json();
    })
    .then(parseUsgs)
    .finally(function () { if (timer) clearTimeout(timer); });
}

// Timeout + ONE retry. Rejects on final failure so the caller can show the note.
function fetchRiver(period) {
  return fetchRiverOnce(period).catch(function () {
    return fetchRiverOnce(period);
  });
}

// ---- Live reading refresh (uses 1-day pull, latest entry = current) ----
// Also seeds the chart from the same P1D points so first paint is instant.
function refreshCurrent() {
  return fetchRiver('P1D').then(function (pts) {
    if (!pts.length) throw new Error('no points');
    var last = pts[pts.length - 1];
    renderCurrent(last.gage, last.t);
    return pts;
  }).catch(function (e) {
    $('river-note').hidden = false;
    throw e;
  });
}

// ---- Chart (dependency-free inline SVG) ----
// Coordinate mapping:
//   depth -> y:  y = PAD.t + (1 - depth/Y_MAX) * plotH   (Y fixed 0..12 ft, top=12)
//   time  -> x:  x = PAD.l + ((t - tMin)/(tMax - tMin)) * plotW
var SVG_NS = 'http://www.w3.org/2000/svg';
var VB_W = 600, VB_H = 240;               // viewBox units; scales to .chart-box via width:100%
var PAD = { t: 14, r: 14, b: 26, l: 34 }; // inner plot margins
var Y_MAX = 12;                           // fixed Y axis ceiling, ft
var Y_TICKS = [0, 2, 4, 6, 8, 10, 12];
var REF_BANK = 10, REF_IAN = 9.3;

var currentPeriod = 'P7D';
var firstChartLoad = true;
var lastChartPts = null;                  // most recent rendered point set (for in-place updates)

function plotW() { return VB_W - PAD.l - PAD.r; }
function plotH() { return VB_H - PAD.t - PAD.b; }
function depthToY(depth) { return PAD.t + (1 - depth / Y_MAX) * plotH(); }
function timeToX(t, tMin, tSpan) { return PAD.l + (tSpan ? (t - tMin) / tSpan : 0) * plotW(); }

function cssVar(name, fallback) {
  var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function svgEl(name, attrs) {
  var el = document.createElementNS(SVG_NS, name);
  for (var k in attrs) { if (attrs.hasOwnProperty(k)) el.setAttribute(k, attrs[k]); }
  return el;
}

// Build x-axis tick times. Hours for P1D, dates for P7D/P90D. ~5-6 ticks.
function xTicks(tMin, tMax) {
  var ticks = [];
  var count = 5;
  for (var i = 0; i <= count; i++) ticks.push(tMin + (tMax - tMin) * (i / count));
  return ticks;
}

function fmtTick(t, period) {
  var d = new Date(t);
  if (period === 'P1D') {
    var h = d.getHours();
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ampm;
  }
  return (d.getMonth() + 1) + '/' + d.getDate();
}

// Loading indicator (reuses #chart-note). Loading and error use distinct text.
function setChartNote(text) {
  var n = $('chart-note');
  if (!n) return;
  if (text == null) { n.hidden = true; return; }
  n.textContent = text;
  n.hidden = false;
}

// Render the whole SVG. pts may be empty/null -> axes + reference lines only.
function renderChart(pts) {
  var box = $('chart');
  if (!box) return;
  lastChartPts = pts && pts.length ? pts : lastChartPts;

  var ink = cssVar('--ink-soft', '#5a6660');
  var grid = cssVar('--line', '#e2ddd1');
  var line = cssVar('--state', '#2f8f5b') || '#2f8f5b';

  var svg = svgEl('svg', {
    viewBox: '0 0 ' + VB_W + ' ' + VB_H,
    width: '100%', height: '100%',
    preserveAspectRatio: 'none',
    role: 'img'
  });
  svg.style.display = 'block';

  // Y gridlines + labels
  for (var i = 0; i < Y_TICKS.length; i++) {
    var yv = Y_TICKS[i], y = depthToY(yv);
    svg.appendChild(svgEl('line', {
      x1: PAD.l, y1: y, x2: VB_W - PAD.r, y2: y,
      stroke: grid, 'stroke-width': 1
    }));
    var yl = svgEl('text', {
      x: PAD.l - 6, y: y + 3, 'text-anchor': 'end',
      'font-size': 10, fill: ink
    });
    yl.textContent = String(yv);
    svg.appendChild(yl);
  }

  // Y axis title (rotated)
  var yt = svgEl('text', {
    x: 10, y: PAD.t + plotH() / 2,
    'text-anchor': 'middle', 'font-size': 10, fill: ink,
    transform: 'rotate(-90 10 ' + (PAD.t + plotH() / 2) + ')'
  });
  yt.textContent = 'ft above bottom';
  svg.appendChild(yt);

  // Time domain
  var usable = (pts && pts.length) ? pts : null;
  var tMin, tMax, tSpan;
  if (usable) {
    tMin = new Date(usable[0].t).getTime();
    tMax = new Date(usable[usable.length - 1].t).getTime();
    if (tMax <= tMin) tMax = tMin + 1;
    tSpan = tMax - tMin;

    // X ticks + labels
    var tks = xTicks(tMin, tMax);
    for (var j = 0; j < tks.length; j++) {
      var x = timeToX(tks[j], tMin, tSpan);
      var xl = svgEl('text', {
        x: x, y: VB_H - PAD.b + 14, 'text-anchor': 'middle',
        'font-size': 10, fill: ink
      });
      xl.textContent = fmtTick(tks[j], currentPeriod);
      svg.appendChild(xl);
    }

    // Data line + fill
    var dPts = [];
    for (var k = 0; k < usable.length; k++) {
      var depth = floorDepth(gageToDepth(usable[k].gage));
      var px = timeToX(new Date(usable[k].t).getTime(), tMin, tSpan);
      var py = depthToY(depth);
      dPts.push([px, py]);
    }
    if (dPts.length) {
      var dLine = 'M' + dPts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' L');
      var baseY = depthToY(0);
      var dFill = dLine + ' L' + dPts[dPts.length - 1][0].toFixed(1) + ',' + baseY +
                  ' L' + dPts[0][0].toFixed(1) + ',' + baseY + ' Z';
      svg.appendChild(svgEl('path', { d: dFill, fill: line, 'fill-opacity': 0.13, stroke: 'none' }));
      svg.appendChild(svgEl('path', {
        d: dLine, fill: 'none', stroke: line, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      }));
    }
  }

  // Reference lines span full plot width
  var x0 = PAD.l, x1 = VB_W - PAD.r;

  // Bank top (y=10) solid red, label pill top-left
  var yBank = depthToY(REF_BANK);
  svg.appendChild(svgEl('line', { x1: x0, y1: yBank, x2: x1, y2: yBank, stroke: '#b21f1f', 'stroke-width': 2 }));
  appendPill(svg, 'Bank top — my property', x0 + 2, yBank - 14, 'start', 'rgba(178,31,31,.92)');

  // Ian (y=9.3) dashed orange, label pill right, dropped below its line (offset from bank pill)
  var yIan = depthToY(REF_IAN);
  svg.appendChild(svgEl('line', {
    x1: x0, y1: yIan, x2: x1, y2: yIan,
    stroke: '#e08a1e', 'stroke-width': 2, 'stroke-dasharray': '5 4'
  }));
  appendPill(svg, '50-yr high — Hurricane Ian 2022', x1 - 2, yIan + 4, 'end', 'rgba(224,138,30,.92)');

  box.innerHTML = '';
  box.appendChild(svg);
}

// Draw a small rounded label pill. anchor = 'start' | 'end' (text + box align).
function appendPill(svg, text, x, y, anchor, bg) {
  var charW = 5.0, padX = 5, h = 13;
  var w = text.length * charW + padX * 2;
  var rectX = (anchor === 'end') ? (x - w) : x;
  var g = svgEl('g', {});
  g.appendChild(svgEl('rect', { x: rectX, y: y, width: w, height: h, rx: 3, ry: 3, fill: bg }));
  var tx = (anchor === 'end') ? (x - padX) : (x + padX);
  var t = svgEl('text', {
    x: tx, y: y + 9.5, 'text-anchor': anchor,
    'font-size': 9, 'font-weight': 700, fill: '#fff'
  });
  t.textContent = text;
  g.appendChild(t);
  svg.appendChild(g);
}

// Refresh chart for a range: fetch (timeout+retry) and re-render the SVG.
function refreshChart(period) {
  currentPeriod = period;
  var haveData = lastChartPts && lastChartPts.length;
  if (firstChartLoad && !haveData) setChartNote('Loading…');
  return fetchRiver(period).then(function (pts) {
    if (!pts.length) throw new Error('no chart points');
    setChartNote(null);
    renderChart(pts);
    firstChartLoad = false;
  }).catch(function (e) {
    // Keep any existing render; surface that this range is unavailable.
    if (haveData) {
      setChartNote('showing 24h — ' + periodWord(period) + ' unavailable');
    } else {
      setChartNote('Chart data unavailable, retrying…');
    }
    throw e;
  });
}

function periodWord(period) {
  return period === 'P90D' ? '90d' : (period === 'P7D' ? '7d' : '24h');
}

// ---- Storm alerts (NWS) ----
function refreshAlerts() {
  return fetch('https://api.weather.gov/alerts/active?point=' + POINT, {
    cache: 'no-store',
    headers: { 'Accept': 'application/geo+json' }
  })
    .then(function (r) {
      if (!r.ok) throw new Error('nws ' + r.status);
      return r.json();
    })
    .then(function (json) {
      var feats = (json && json.features) || [];
      var hit = null;
      for (var i = 0; i < feats.length; i++) {
        var p = feats[i].properties || {};
        if (ALERT_EVENTS.indexOf(p.event) !== -1) { hit = p; break; }
      }
      var banner = $('alert-banner');
      if (hit) {
        $('alert-event').textContent = hit.event;
        $('alert-headline').textContent = hit.headline || hit.description || '';
        $('alert-expires').textContent = hit.expires ? 'Expires ' + fmtTime(hit.expires) : '';
        banner.hidden = false;
      } else {
        banner.hidden = true;
      }
    })
    .catch(function (e) {
      // On failure, leave whatever banner state exists; don't fabricate an alert.
    });
}

// ---- Range toggle wiring ----
function wireControls() {
  var btns = document.querySelectorAll('.rng');
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener('click', function () {
      var all = document.querySelectorAll('.rng');
      for (var j = 0; j < all.length; j++) all[j].classList.remove('active');
      this.classList.add('active');
      refreshChart(this.getAttribute('data-period'));
    });
  }
}

function activePeriod() {
  var active = document.querySelector('.rng.active');
  return active ? active.getAttribute('data-period') : 'P7D';
}

// ---- Boot ----
function boot() {
  renderLadder();
  wireControls();
  // Paint axes + reference lines instantly (no data yet) so the box is never blank.
  renderChart(null);

  // One P1D fetch drives both the current reading AND the chart's first paint (24h).
  // Then, if the active range isn't 24h, background-fetch it and re-render.
  refreshCurrent().then(function (p1dPts) {
    currentPeriod = 'P1D';
    renderChart(p1dPts);          // instant 24h render
    firstChartLoad = false;
    var period = activePeriod();
    if (period !== 'P1D') {
      refreshChart(period).catch(function () {
        // 24h render stays; refreshChart already set the "showing 24h — Nd unavailable" note.
      });
    }
  }).catch(function () {
    // P1D failed entirely (river-note already shown). Try the active range directly.
    refreshChart(activePeriod()).catch(function () { /* note already set */ });
  });

  refreshAlerts();

  setInterval(function () {
    refreshCurrent().catch(function () { /* river-note shown */ });
    refreshAlerts();
    // refresh the chart for the active range so the trend stays live
    refreshChart(activePeriod()).catch(function () { /* keep prior render */ });
  }, REFRESH_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
