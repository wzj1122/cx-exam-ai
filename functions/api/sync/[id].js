/**
 * 配置云同步接口（Cloudflare Pages Functions，跑在 cx-exam-ai.pages.dev 域名下）。
 *
 * 为什么需要它：超星有 i. / mooc1 / mooc2-ans / passport2 等多个子域，而浏览器存储
 * （localStorage / 油猴 GM 存储）都按 origin 隔离 —— 设置页写的配置考试页根本读不到。
 * 服务端中转是唯一能跨子域、跨设备都成立的通道。
 *
 * 安全模型（零知识）：
 *   - 客户端用随机 key 做 AES-GCM 加密，**key 从不上传**；
 *   - 服务端只存密文 blob + 写权限令牌 token（HMAC(key,'write') 的摘要）；
 *   - 因此即使 KV 泄露，没有 key 也解不开配置；token 也无法反推 key。
 *
 * 路由：
 *   GET    /api/sync/<id>   → { blob, at }   （密文，谁拿到 id 都能取，但没有 key 解不开）
 *   PUT    /api/sync/<id>   → 需要 x-cxai-token，首次写入即绑定该 id 的写权限
 *   DELETE /api/sync/<id>   → 需要 x-cxai-token，停用（删除本机同步码用）
 */

const PREFIX = 'cfg:';
const MAX_BLOB = 24000; // 密文上限（base64），配置 JSON ~4KB 加密后远小于此
const TTL_SECONDS = 60 * 60 * 24 * 90; // 90 天不更新自动回收

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-cxai-token',
      'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS'
    }
  });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const method = (request.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') return json({ ok: true });

  const id = String((params && params.id) || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (id.length < 6 || id.length > 48) return json({ error: 'bad id' }, 400);
  if (!env || !env.CFG_KV) return json({ error: 'kv not bound' }, 500);

  const key = PREFIX + id;

  if (method === 'GET') {
    const rec = await env.CFG_KV.get(key, 'json');
    if (!rec) return json({ error: 'not found' }, 404);
    return json({ blob: rec.blob, at: rec.at });
  }

  if (method === 'PUT') {
    const token = String(request.headers.get('x-cxai-token') || '');
    if (token.length < 16) return json({ error: 'missing token' }, 401);

    let body = null;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'bad json' }, 400);
    }
    const blob = String((body && body.blob) || '');
    if (!blob) return json({ error: 'empty blob' }, 400);
    if (blob.length > MAX_BLOB) return json({ error: 'too large' }, 413);

    const old = await env.CFG_KV.get(key, 'json');
    // 首次写入即绑定这个 id 的写权限；之后必须用同一个 token 才能覆盖
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
