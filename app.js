/* Little Wekiva Watch — client-side data + logic. No build step. */
'use strict';

// ---- Constants (verified facts; do not re-derive) ----
var SITE = '02234990';
var POINT = '28.6716,-81.4131';
var BANK_HEIGHT = 10;            // ft, local depth at bank overtop (my property)
var GAGE_BASE = 23.41;           // gage height at ~0.5 ft local depth
var DEPTH_AT_BASE = 0.5;
var SLOPE = 1.146;               // local_depth = 0.5 + 1.146*(gage - 23.41)
var REFRESH_MS = 12 * 60 * 1000; // ~12 min auto-refresh

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
  var depth = gageToDepth(gage);
  var shown = depth < 0 ? 0 : depth;
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

function fetchRiver(period) {
  return fetch(usgsUrl(period), { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('usgs ' + r.status);
      return r.json();
    })
    .then(parseUsgs);
}

// ---- Live reading refresh (uses 1-day pull, latest entry = current) ----
function refreshCurrent() {
  return fetchRiver('P1D').then(function (pts) {
    if (!pts.length) throw new Error('no points');
    var last = pts[pts.length - 1];
    renderCurrent(last.gage, last.t);
  }).catch(function (e) {
    $('river-note').hidden = false;
  });
}

// ---- Chart ----
var chart = null;
var currentPeriod = 'P7D';
var firstChartLoad = true;

// Register the annotation plugin (UMD global) ONCE at top level, after libs load.
// Guard both possible UMD global names; skip gracefully if neither is present.
(function registerAnnotationPlugin() {
  if (typeof Chart === 'undefined') return;
  var ann = window.ChartAnnotation || window['chartjs-plugin-annotation'];
  if (ann) {
    try { Chart.register(ann); } catch (e) { /* already registered or bad plugin — draw without */ }
  }
})();

// Build the static chart config (scales / plugins / annotations). Shared by
// the empty-init at boot and every later in-place update.
function buildChartConfig() {
  var line = getComputedStyle(document.documentElement).getPropertyValue('--state').trim() || '#2f8f5b';
  var ink = getComputedStyle(document.documentElement).getPropertyValue('--ink-soft').trim() || '#5a6660';
  var grid = getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#e2ddd1';

  return {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderColor: line,
        backgroundColor: line + '22',
        borderWidth: 2,
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: currentPeriod === 'P1D' ? 'hour' : 'day',
            displayFormats: { hour: 'ha', day: 'M/d' }
          },
          grid: { color: grid, drawTicks: false },
          ticks: { color: ink, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 11 } },
          border: { display: false }
        },
        y: {
          min: 0,
          max: 12,
          title: { display: true, text: 'ft above bottom', color: ink, font: { size: 11 } },
          grid: { color: grid, drawTicks: false },
          ticks: { color: ink, font: { size: 11 } },
          border: { display: false }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (c) { return c.parsed.y.toFixed(1) + ' ft above bottom'; }
          }
        },
        annotation: {
          clip: false,
          annotations: {
            bankTop: {
              type: 'line',
              yMin: 10,
              yMax: 10,
              borderColor: '#b21f1f',
              borderWidth: 2,
              label: {
                display: true,
                content: 'Bank top — my property',
                position: 'start',
                yAdjust: -9,
                backgroundColor: 'rgba(178,31,31,.92)',
                color: '#fff',
                font: { size: 10, weight: '700' },
                padding: { top: 2, bottom: 2, left: 5, right: 5 },
                borderRadius: 4
              }
            },
            ian: {
              type: 'line',
              yMin: 9.3,
              yMax: 9.3,
              borderColor: '#e08a1e',
              borderWidth: 2,
              borderDash: [5, 4],
              label: {
                display: true,
                content: '50-yr high — Hurricane Ian 2022',
                position: 'end',
                yAdjust: 9,
                backgroundColor: 'rgba(224,138,30,.92)',
                color: '#fff',
                font: { size: 10, weight: '700' },
                padding: { top: 2, bottom: 2, left: 5, right: 5 },
                borderRadius: 4
              }
            }
          }
        }
      }
    }
  };
}

// Build the chart instance once, with empty data, so axes + annotation lines
// paint immediately on load — before any USGS data arrives.
function initChart() {
  if (typeof Chart === 'undefined') return; // defer ordering should prevent this; stay safe
  var el = $('chart');
  if (!el) return;
  if (chart) return;
  chart = new Chart(el.getContext('2d'), buildChartConfig());
}

// Loading indicator (reuses #chart-note). Loading and error use distinct text.
function showChartLoading() {
  var n = $('chart-note');
  if (!n) return;
  n.textContent = 'Loading…';
  n.hidden = false;
}
function hideChartNote() {
  var n = $('chart-note');
  if (n) n.hidden = true;
}
function showChartError() {
  var n = $('chart-note');
  if (!n) return;
  n.textContent = 'Chart data unavailable, retrying…';
  n.hidden = false;
}

// Update the existing chart's data + x-axis unit in place. No destroy/recreate.
function applyChartData(pts) {
  if (!chart) initChart();
  if (!chart) return; // Chart lib genuinely unavailable
  var labels = [], data = [];
  for (var i = 0; i < pts.length; i++) {
    labels.push(new Date(pts[i].t));
    data.push(Number(gageToDepth(pts[i].gage).toFixed(2)));
  }
  chart.data.labels = labels;
  chart.data.datasets[0].data = data;
  chart.options.scales.x.time.unit = (currentPeriod === 'P1D') ? 'hour' : 'day';
  chart.update();
}

function refreshChart(period) {
  currentPeriod = period;
  // Update the x-axis unit on the existing chart immediately on a range change.
  if (chart) chart.options.scales.x.time.unit = (period === 'P1D') ? 'hour' : 'day';
  if (firstChartLoad) showChartLoading();
  return fetchRiver(period).then(function (pts) {
    if (!pts.length) throw new Error('no chart points');
    hideChartNote();
    applyChartData(pts);
    firstChartLoad = false;
  }).catch(function (e) {
    showChartError();
  });
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

// ---- Boot ----
function boot() {
  renderLadder();
  wireControls();
  // Build the empty chart first so axes + annotation lines paint instantly.
  // Wrapped so a chart failure can't kill current-reading / alerts rendering.
  try { initChart(); } catch (e) { /* keep booting */ }
  refreshCurrent();
  refreshChart('P7D');
  refreshAlerts();

  setInterval(function () {
    refreshCurrent();
    refreshAlerts();
    // also refresh the chart for the active range so the trend stays live
    var active = document.querySelector('.rng.active');
    refreshChart(active ? active.getAttribute('data-period') : 'P7D');
  }, REFRESH_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
