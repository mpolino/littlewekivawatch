/* Same-origin proxy for NWS active alerts. UA mandatory — NWS 403s without. */
export async function onRequestGet({ request }) {
  try {
    var upstream = await fetch(
      'https://api.weather.gov/alerts/active?point=28.6716,-81.4131',
      {
        headers: {
          'User-Agent': 'LittleWekivaWatch/1.0 (littlewekivawatch.pages.dev; contact mpolino)',
          'Accept': 'application/geo+json'
        }
      }
    );
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: 'nws upstream' }), {
        status: 502,
        headers: { 'content-type': 'application/json' }
      });
    }
    var body = await upstream.text();
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'Cache-Control': 'public, max-age=120'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'nws upstream' }), {
      status: 502,
      headers: { 'content-type': 'application/json' }
    });
  }
}
