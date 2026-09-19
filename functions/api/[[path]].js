const API_ORIGIN = 'https://splint-api.onrender.com';

export function buildUpstreamUrl(requestUrl) {
  const incoming = new URL(requestUrl);
  const path = incoming.pathname.replace(/^\/api\/?/, '/');
  return new URL(`${path}${incoming.search}`, API_ORIGIN);
}

export function buildUpstreamHeaders(request) {
  const headers = new Headers(request.headers);
  // The browser talks to the Pages origin; the API must see the real client
  // address, original host, and HTTPS scheme for redirects and rate limiting.
  headers.delete('host');
  headers.delete('content-length');
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) headers.set('x-forwarded-for', clientIp);
  headers.set('x-forwarded-proto', 'https');
  headers.set('x-forwarded-host', new URL(request.url).host);
  return headers;
}

/**
 * Same-origin API gateway for the standalone browser product. The OIDC
 * callback and session cookie must live on the application origin
 * (`BROWSER_AUTH_ORIGIN`) so the session is sent with every request under
 * SameSite=Lax. The Telegram Mini App keeps calling the API origin directly
 * with signed initData.
 */
export async function onRequest(context) {
  const request = context.request;
  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  let upstream;
  try {
    upstream = await fetch(buildUpstreamUrl(request.url).toString(), {
      method,
      headers: buildUpstreamHeaders(request),
      body: hasBody ? request.body : undefined,
      // Pass upstream 3xx (Telegram authorization redirect) through untouched.
      redirect: 'manual',
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Сервис временно недоступен', code: 'API_PROXY_UPSTREAM_ERROR' }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const responseHeaders = new Headers(upstream.headers);
  // Let the runtime recompute framing after streaming the upstream body.
  responseHeaders.delete('content-length');
  responseHeaders.delete('content-encoding');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
