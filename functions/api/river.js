/* Same-origin proxy for USGS instantaneous-values (gage height). */
export async function onRequestGet({ request }) {
  var allowed = { P1D: 1, P7D: 1, P90D: 1 };
  var url = new URL(request.url);
  var period = url.searchParams.get('period');
  if (!allowed[period]) period = 'P7D';

  try {
    var upstream = await fetch(
      'https://nwis.waterservices.usgs.gov/nwis/iv/?sites=02234990&parameterCd=00065&format=json&period=' + period
    );
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: 'usgs upstream' }), {
        status: 502,
        headers: { 'content-type': 'application/json' }
      });
    }
    var body = await upstream.text();
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'Cache-Control': 'public, max-age=300'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'usgs upstream' }), {
      status: 502,
      headers: { 'content-type': 'application/json' }
    });
  }
}
