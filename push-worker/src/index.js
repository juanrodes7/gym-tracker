/* ============================================================
   Gym Tracker — servidor de avisos del timer.
   La app le dice "avísame en X segundos" y, llegado el momento,
   este Worker envía una notificación push al móvil aunque la app
   esté cerrada. Cada móvil tiene su propio Durable Object (su alarma).
   ============================================================ */

const ALLOWED_ORIGINS = ['https://juanrodes7.github.io', 'http://localhost:5173'];

// Solo enviamos a servicios push reales (Apple, Google, Mozilla, Microsoft)
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (request.method !== 'POST' || !['/schedule', '/cancel'].includes(url.pathname)) {
      return new Response('Gym Tracker push', { status: 404, headers: cors });
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'json' }, 400, cors); }
    const id = String(body.id || '');
    if (!/^[a-z0-9]{8,40}$/i.test(id)) return json({ error: 'id' }, 400, cors);

    if (url.pathname === '/schedule') {
      const sub = body.subscription;
      const at = Number(body.at);
      if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return json({ error: 'subscription' }, 400, cors);
      let host;
      try { host = new URL(sub.endpoint).hostname; } catch { return json({ error: 'endpoint' }, 400, cors); }
      if (!PUSH_HOSTS.some((re) => re.test(host))) return json({ error: 'endpoint' }, 400, cors);
      if (!Number.isFinite(at) || at < Date.now() - 5000 || at > Date.now() + 3600_000) return json({ error: 'at' }, 400, cors);
    }

    const stub = env.TIMERS.get(env.TIMERS.idFromName(id));
    const res = await stub.fetch(`https://do${url.pathname}`, { method: 'POST', body: JSON.stringify(body) });
    return new Response(res.body, { status: res.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  },
};

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

export class RestTimer {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const body = await request.json();
    if (url.pathname === '/schedule') {
      await this.state.storage.put('job', {
        subscription: body.subscription,
        title: String(body.title || '⏱ ¡Descanso terminado!').slice(0, 80),
        body: String(body.body || 'A por la siguiente serie 💪').slice(0, 160),
      });
      await this.state.storage.setAlarm(Number(body.at));
      return json({ ok: true });
    }
    // /cancel
    await this.state.storage.deleteAlarm();
    await this.state.storage.delete('job');
    return json({ ok: true });
  }

  async alarm() {
    const job = await this.state.storage.get('job');
    if (!job) return;
    await this.state.storage.delete('job');
    const res = await sendPush(job.subscription, JSON.stringify({ title: job.title, body: job.body }), this.env);
    if (!res.ok) console.log('push failed', res.status, await res.text());
  }
}

/* ---------- Web Push (VAPID + cifrado aes128gcm, RFC 8291/8292) ---------- */

const enc = new TextEncoder();
const b64u = {
  encode: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

async function vapidHeader(endpoint, env) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.encode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT,
  })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u.encode(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

async function encryptPayload(subscription, payload) {
  const uaPublic = b64u.decode(subscription.keys.p256dh);
  const authSecret = b64u.decode(subscription.keys.auth);

  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

  const prkKey = await hmac(authSecret, ecdhSecret);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plaintext = concat(enc.encode(payload), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

async function sendPush(subscription, payload, env) {
  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(subscription.endpoint, env),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '60',
      Urgency: 'high',
    },
    body: await encryptPayload(subscription, payload),
  });
}
