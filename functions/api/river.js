/* Same-origin proxy for USGS gage height (site 02234990, parameter 00065).
 *
 * Source: USGS Water Data OGC API (api.waterdata.usgs.gov), which replaced the
 * legacy NWIS waterservices feed (that one slowed to 12-25s per call in Nov 2026).
 * The response is reshaped into the legacy NWIS JSON shape
 * (value.timeSeries[0].values[0].value[] = {value, dateTime}) so app.js is unchanged.
 *
 * Responses are cached at the Cloudflare edge for 5 minutes per period, so a slow
 * USGS day costs one visitor per colo per 5 minutes, not every visitor.
 */
var TTL = 300;
var ALLOWED = { P1D: 1, P7D: 1, P90D: 1 };

function json(body, status, cacheSeconds) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: status,
    headers: {
      'content-type': 'application/json',
      'Cache-Control': cacheSeconds ? 'public, max-age=' + cacheSeconds : 'no-store'
    }
  });
}

export async function onRequestGet(context) {
  var url = new URL(context.request.url);
  var period = url.searchParams.get('period');
  if (!ALLOWED[period]) period = 'P7D';

  var cache = caches.default;
  var cacheKey = new Request(url.origin + '/api/river?period=' + period, { method: 'GET' });
  var hit = await cache.match(cacheKey);
  if (hit) return hit;

  var upstreamUrl =
    'https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items' +
    '?monitoring_location_id=USGS-02234990&parameter_code=00065' +
    '&time=' + period +
    '&sortby=time&properties=time,value&skipGeometry=true&limit=10000&f=json';

  try {
    var upstream = await fetch(upstreamUrl, { headers: { accept: 'application/geo+json' } });
    if (!upstream.ok) return json({ error: 'usgs upstream', status: upstream.status }, 502);
    var data = await upstream.json();
    var feats = (data && data.features) || [];
    var values = [];
    for (var i = 0; i < feats.length; i++) {
      var p = feats[i].properties || {};
      if (p.value == null || p.time == null) continue;
      values.push({ value: String(p.value), dateTime: p.time });
    }
    if (!values.length) return json({ error: 'usgs empty' }, 502);

    var body = JSON.stringify({ value: { timeSeries: [{ values: [{ value: values }] }] } });
    var res = json(body, 200, TTL);
    context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (e) {
    return json({ error: 'usgs upstream' }, 502);
  }
}
