const BINANCE_BASE_URL = 'https://api.binance.com';
const DEFAULT_SYMBOL = 'BTCUSDT';
const DEFAULT_INTERVAL = '1m';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const ALLOWED_INTERVALS = new Set([
  '1s',
  '1m', '3m', '5m', '15m', '30m',
  '1h', '2h', '4h', '6h', '8h', '12h',
  '1d', '3d', '1w', '1M'
]);

export default {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'OPTIONS') {
      return jsonResponse({ error: 'Method Not Allowed', message: 'Use GET requests only.' }, 405);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '') {
      return jsonResponse({
        service: 'binance-kline-api',
        status: 'ok',
        endpoints: {
          health: '/health',
          kline: '/kline?symbol=BTCUSDT&interval=1m&limit=100',
          klines: '/klines?symbol=ETHUSDT&interval=5m&limit=200'
        },
        note: 'Use /kline or /klines with query params: symbol, interval, limit, startTime, endTime'
      });
    }

    if (url.pathname === '/health') {
      return jsonResponse({ status: 'ok' }, 200);
    }

    const pathname = url.pathname.endsWith('/') && url.pathname !== '/' ? url.pathname.slice(0, -1) : url.pathname;

    if (pathname !== '/kline' && pathname !== '/klines') {
      return jsonResponse(
        {
          error: 'Not Found',
          message: 'Use /kline or /klines with query params: symbol, interval, limit, startTime, endTime'
        },
        404
      );
    }

    const symbol = (url.searchParams.get('symbol') || DEFAULT_SYMBOL).toUpperCase();
    const interval = url.searchParams.get('interval') || DEFAULT_INTERVAL;
    const limit = clampLimit(url.searchParams.get('limit'));
    const startTime = parseTime(url.searchParams.get('startTime'));
    const endTime = parseTime(url.searchParams.get('endTime'));

    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
      return jsonResponse({ error: 'Invalid symbol format' }, 400);
    }

    if (!ALLOWED_INTERVALS.has(interval)) {
      return jsonResponse({ error: 'Invalid interval' }, 400);
    }

    if (startTime !== null && endTime !== null && startTime > endTime) {
      return jsonResponse({ error: 'startTime must be <= endTime' }, 400);
    }

    const query = new URLSearchParams({
      symbol,
      interval,
      limit: String(limit)
    });

    if (startTime !== null) query.set('startTime', String(startTime));
    if (endTime !== null) query.set('endTime', String(endTime));

    const upstreamUrl = `${BINANCE_BASE_URL}/api/v3/klines?${query.toString()}`;

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        headers: {
          'User-Agent': 'kline-worker/1.0'
        }
      });

      const text = await upstreamResponse.text();

      if (!upstreamResponse.ok) {
        return jsonResponse(
          {
            error: 'Upstream error',
            status: upstreamResponse.status,
            details: safeParseJSON(text)
          },
          502
        );
      }

      return jsonResponse({
        symbol,
        interval,
        limit,
        source: 'binance',
        data: safeParseJSON(text)
      });
    } catch (error) {
      return jsonResponse(
        {
          error: 'Failed to fetch Binance kline data',
          message: error instanceof Error ? error.message : String(error)
        },
        502
      );
    }
  }
};

function parseTime(value) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

function clampLimit(rawLimit) {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(parsed), MAX_LIMIT);
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders()
    }
  });
}
