/**
 * CX 考试 AI v2 · 配置云同步（Cloudflare Pages Functions + KV `CFG_KV`）。
 *
 * 安全模型与旧版一致：客户端 AES-GCM 加密，密钥从不上传；服务端只存密文
 * 与写权限令牌（HMAC(key, 'cx-exam-ai:write:v2')）。
 *
 * GET    /api/sync/<id>  -> { blob, at }
 * PUT    /api/sync/<id>  -> 需要 x-cxai-token
 * DELETE /api/sync/<id>  -> 需要 x-cxai-token
 */

const PREFIX = 'cfg2:';
const MAX_BLOB = 64000;
const TTL_SECONDS = 60 * 60 * 24 * 90;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-cxai-token',
      'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
    },
  });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const method = String(request.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return json({ ok: true });

  const id = String((params && params.id) || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (id.length < 6 || id.length > 48) return json({ error: 'bad id' }, 400);
  if (!env || !env.CFG_KV) return json({ error: 'kv not bound' }, 500);

  const key = PREFIX + id;

  if (method === 'GET') {
    const record = await env.CFG_KV.get(key, 'json');
    if (!record) return json({ error: 'not found' }, 404);
    return json({ blob: record.blob, at: record.at });
  }

  if (method === 'PUT') {
    const token = String(request.headers.get('x-cxai-token') || '');
    if (token.length < 16) return json({ error: 'missing token' }, 401);
    let body = null;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'bad json' }, 400);
    }
    const blob = String((body && body.blob) || '');
    if (!blob) return json({ error: 'empty blob' }, 400);
    if (blob.length > MAX_BLOB) return json({ error: 'too large' }, 413);
    const old = await env.CFG_KV.get(key, 'json');
    if (old && old.token && old.token !== token) return json({ error: 'forbidden' }, 403);
    const at = Date.now();
    await env.CFG_KV.put(key, JSON.stringify({ blob, token, at }), { expirationTtl: TTL_SECONDS });
    return json({ ok: true, at });
  }

  if (method === 'DELETE') {
    const token = String(request.headers.get('x-cxai-token') || '');
    const old = await env.CFG_KV.get(key, 'json');
    if (old && old.token && old.token !== token) return json({ error: 'forbidden' }, 403);
    await env.CFG_KV.delete(key);
    return json({ ok: true });
  }

  return json({ error: 'method not allowed' }, 405);
}
