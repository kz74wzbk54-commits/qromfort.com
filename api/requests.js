'use strict';
/*
  Qromfort API — one serverless function, no dependencies.

  Patient phone
    GET  /api/requests?room=12                  -> that room's open requests
    POST /api/requests  {room, type}            -> ask for something
    POST /api/requests  {action:'cancel', id, token}

  Staff board (needs the PIN once, then a 30-day session)
    POST /api/requests  {action:'unlock', pin}  -> {session}
    GET  /api/requests                          -> every open request
    POST /api/requests  {action:'ack',  id}     -> "On my way"
    POST /api/requests  {action:'done', id}     -> clear it

  Environment variables (Vercel > Settings > Environment Variables)
    KV_REST_API_URL / KV_REST_API_TOKEN   added automatically by the Upstash Redis integration
    BOARD_PIN                             staff PIN for the board (required)
    NTFY_TOPIC                            optional: push alerts through ntfy
    NTFY_TOKEN                            optional: ntfy access token (paid or account limits)
    NTFY_SERVER                           optional: defaults to https://ntfy.sh
*/
const crypto = require('crypto');

/* ---------- config: keep in step with CONFIG in index.html ---------- */
const ROOMS = {};
for (let i = 1; i <= 50; i++) {
  if (i === 42 || i === 43) {
    ROOMS[i + 'A'] = { kind: 'bed', label: 'Room ' + i + 'A' };
    ROOMS[i + 'B'] = { kind: 'bed', label: 'Room ' + i + 'B' };
  } else {
    ROOMS[String(i)] = { kind: 'bed', label: 'Room ' + i };
  }
}
for (let c = 1; c <= 5; c++) ROOMS['C' + c] = { kind: 'chair', label: 'Chair ' + c };
for (let t = 1; t <= 2; t++) ROOMS['T' + t] = { kind: 'triage', label: 'Triage ' + t };

const TYPES = {
  blanket:  { label: 'Warm blanket' },
  pillow:   { label: 'Pillow' },
  water:    { label: 'Water or ice (check NPO)' },
  lights:   { label: 'Lights dimmed', notFor: ['chair'] },
  charger:  { label: 'Phone charger' },
  bathroom: { label: 'Bathroom help', urgent: true },
  other:    { label: 'Stop by' }
};

const KEY = 'qromfort:requests';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;        // open requests older than this are dropped
const CACHE_MS = 3000;                        // short in-memory cache to save database reads
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;  // how long a board stays unlocked
const CREATE_LIMIT = 40;                      // new requests per 5 minutes from one network
const PIN_TRIES = 10;                         // wrong PINs per 10 minutes from one network
const RENOTIFY_SECONDS = 120;                 // no second push for the same room + item inside this

/* ---------- database (Upstash Redis REST) ---------- */
function dbEnv() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token: token } : null;
}
async function redis(db, commands) {
  const r = await fetch(db.url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + db.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  if (!r.ok) throw new Error('database responded ' + r.status);
  const out = await r.json();
  return out.map(function (o) {
    if (o && o.error) throw new Error(o.error);
    return o ? o.result : null;
  });
}

let cache = null;
async function loadAll(db, fresh) {
  const now = Date.now();
  if (!fresh && cache && now - cache.at < CACHE_MS) return cache.list;
  const res = await redis(db, [['HGETALL', KEY]]);
  let raw = res[0] || [];
  if (!Array.isArray(raw)) {                       // tolerate an object-shaped reply
    const flat = [];
    Object.keys(raw).forEach(function (k) { flat.push(k, raw[k]); });
    raw = flat;
  }
  const list = [], stale = [];
  for (let i = 0; i < raw.length; i += 2) {
    const rec = parse(raw[i + 1]);
    if (!rec || !ROOMS[rec.room] || !TYPES[rec.type] || now - rec.createdAt > MAX_AGE_MS) stale.push(raw[i]);
    else { rec.id = raw[i]; list.push(rec); }
  }
  if (stale.length) await redis(db, [['HDEL', KEY].concat(stale)]);
  cache = { at: now, list: list };
  return list;
}
function parse(v) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return null; }
}
function pub(rec) {            // never send the cancel token back out
  return { id: rec.id, room: rec.room, type: rec.type, createdAt: rec.createdAt, ackAt: rec.ackAt || null };
}

/* ---------- board sessions ---------- */
function sign(exp) {
  const key = crypto.createHash('sha256').update('qromfort-session:' + process.env.BOARD_PIN).digest();
  return crypto.createHmac('sha256', key).update(String(exp)).digest('hex');
}
function makeSession() {
  const exp = Date.now() + SESSION_MS;
  return exp + '.' + sign(exp);
}
function sessionOk(value) {
  if (!process.env.BOARD_PIN || typeof value !== 'string') return false;
  const dot = value.indexOf('.');
  if (dot < 1) return false;
  const exp = Number(value.slice(0, dot));
  if (!exp || exp < Date.now()) return false;
  return same(value.slice(dot + 1), sign(exp));
}
function same(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/* ---------- helpers ---------- */
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (fwd || 'unknown').replace(/[^0-9a-fA-F.:]/g, '').slice(0, 64) || 'unknown';
}
async function readBody(req) {
  try {
    if (req.body !== undefined && req.body !== null) {
      return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
  } catch (e) { return {}; }
  return new Promise(function (resolve) {
    let data = '';
    req.on('data', function (c) { data += c; if (data.length > 4096) req.destroy(); });
    req.on('end', function () { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
    req.on('error', function () { resolve({}); });
  });
}
function validId(id) {
  if (typeof id !== 'string') return false;
  const cut = id.indexOf(':');
  return cut > 0 && !!ROOMS[id.slice(0, cut)] && !!TYPES[id.slice(cut + 1)];
}

/* ---------- phone alerts (ntfy) ---------- */
async function alertStaff(rec, req) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  const server = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '');
  const headers = {
    'Content-Type': 'text/plain',
    Title: ROOMS[rec.room].label,
    Priority: TYPES[rec.type].urgent ? 'high' : 'default'
  };
  if (req.headers.host) headers.Click = 'https://' + req.headers.host + '/?view=board';
  if (process.env.NTFY_TOKEN) headers.Authorization = 'Bearer ' + process.env.NTFY_TOKEN;
  const stop = new AbortController();
  const timer = setTimeout(function () { stop.abort(); }, 3000);
  try {
    const r = await fetch(server + '/' + encodeURIComponent(topic), {
      method: 'POST', headers: headers, body: TYPES[rec.type].label, signal: stop.signal
    });
    if (!r.ok) console.error('ntfy responded', r.status);
  } catch (e) {
    console.error('ntfy failed', e && e.message);   // the request itself is still saved
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- handler ---------- */
module.exports = async function handler(req, res) {
  const db = dbEnv();
  if (!db) return send(res, 503, { error: 'no_database' });

  try {
    const url = new URL(req.url, 'http://localhost');
    const session = req.headers['x-board-session'];

    if (req.method === 'GET') {
      const room = url.searchParams.get('room');
      if (room !== null) {
        if (!ROOMS[room]) return send(res, 400, { error: 'unknown_room' });
        const all = await loadAll(db);
        return send(res, 200, { now: Date.now(), requests: all.filter(function (r) { return r.room === room; }).map(pub) });
      }
      if (!process.env.BOARD_PIN) return send(res, 503, { error: 'no_pin' });
      if (!sessionOk(session)) return send(res, 401, { error: 'locked' });
      const all = await loadAll(db);
      return send(res, 200, { now: Date.now(), requests: all.map(pub) });
    }

    if (req.method !== 'POST') return send(res, 405, { error: 'method' });

    const body = (await readBody(req)) || {};
    const action = body.action || 'create';
    const ip = clientIp(req);

    if (action === 'unlock') {
      if (!process.env.BOARD_PIN) return send(res, 503, { error: 'no_pin' });
      const failKey = 'qromfort:pinfail:' + ip;
      const tries = Number((await redis(db, [['GET', failKey]]))[0] || 0);
      if (tries >= PIN_TRIES) return send(res, 429, { error: 'too_many_tries' });
      if (!same(body.pin, process.env.BOARD_PIN)) {
        await redis(db, [['SET', failKey, '0', 'EX', '600', 'NX'], ['INCR', failKey]]);
        return send(res, 401, { error: 'wrong_pin' });
      }
      return send(res, 200, { session: makeSession() });
    }

    if (action === 'create') {
      const room = String(body.room || ''), type = String(body.type || '');
      const spot = ROOMS[room], kind = TYPES[type];
      if (!spot || !kind || (kind.notFor && kind.notFor.indexOf(spot.kind) > -1)) {
        return send(res, 400, { error: 'unknown_request' });
      }
      const id = room + ':' + type;
      const rlKey = 'qromfort:rl:' + ip;
      const first = await redis(db, [['SET', rlKey, '0', 'EX', '300', 'NX'], ['INCR', rlKey], ['HGET', KEY, id]]);
      if (Number(first[1]) > CREATE_LIMIT) return send(res, 429, { error: 'slow_down' });
      const now = Date.now();
      const existing = parse(first[2]);
      if (existing && now - existing.createdAt <= MAX_AGE_MS) {
        existing.id = id;                               // already asked: same request, no new alert
        return send(res, 200, { now: now, request: pub(existing) });
      }
      const rec = { room: room, type: type, createdAt: now, ackAt: null, token: crypto.randomBytes(16).toString('hex') };
      const saved = await redis(db, [
        ['HSET', KEY, id, JSON.stringify(rec)],
        ['SET', 'qromfort:notified:' + id, '1', 'EX', String(RENOTIFY_SECONDS), 'NX']
      ]);
      cache = null;
      rec.id = id;
      if (saved[1] === 'OK') await alertStaff(rec, req);
      return send(res, 200, { now: now, request: pub(rec), token: rec.token });
    }

    if (!validId(body.id)) return send(res, 400, { error: 'unknown_request' });
    const id = body.id;

    if (action === 'cancel') {
      const rec = parse((await redis(db, [['HGET', KEY, id]]))[0]);
      if (rec) {
        if (!body.token || !same(body.token, rec.token)) return send(res, 403, { error: 'not_yours' });
        await redis(db, [['HDEL', KEY, id]]);
        cache = null;
      }
      return send(res, 200, { ok: true });
    }

    if (action === 'ack' || action === 'done') {
      if (!process.env.BOARD_PIN) return send(res, 503, { error: 'no_pin' });
      if (!sessionOk(session)) return send(res, 401, { error: 'locked' });
      if (action === 'done') {
        await redis(db, [['HDEL', KEY, id]]);
      } else {
        const rec = parse((await redis(db, [['HGET', KEY, id]]))[0]);
        if (rec && !rec.ackAt) {
          rec.ackAt = Date.now();
          delete rec.id;
          await redis(db, [['HSET', KEY, id, JSON.stringify(rec)]]);
        }
      }
      cache = null;
      const all = await loadAll(db, true);
      return send(res, 200, { now: Date.now(), requests: all.map(pub) });
    }

    return send(res, 400, { error: 'unknown_action' });
  } catch (e) {
    console.error('qromfort api', e && e.message);
    return send(res, 500, { error: 'server' });
  }
};
