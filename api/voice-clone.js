/**
 * /api/voice-clone — 极简转发代理(Vercel Serverless Function)
 *
 * 作用:当浏览器直连克隆引擎被跨域(CORS)拦截时,页面会自动改为请求
 *   /api/voice-clone?engine=<inworld|elevenlabs|fish>&path=<上游路径>
 * 本函数把请求原样转发给对应的官方接口,再把结果原样返回。
 *
 * - 不保存任何 Key:Key 由浏览器随请求头带过来,只在内存里经过一次。
 * - 不是开放代理:只转发下面白名单里的主机、路径和方法。
 * - 用法:把本文件放在项目的 api/ 目录下,随 git push 部署即可,无需任何配置。
 * - 限制:Vercel 函数的请求体和响应体各约 4.5 MB,页面已按这个上限分段。
 */
const UPSTREAMS = {
  inworld: {
    host: 'https://api.inworld.ai',
    paths: [/^\/voices\/v1\/voices:clone$/, /^\/voices\/v1\/voices\/[^/?#]+$/, /^\/tts\/v1\/voice$/],
    headers: ['authorization'],
  },
  elevenlabs: {
    host: 'https://api.elevenlabs.io',
    paths: [/^\/v1\/voices\/add$/, /^\/v1\/voices\/[^/?#]+$/, /^\/v1\/text-to-speech\/[^/?#]+\?output_format=[a-z0-9_]+$/],
    headers: ['xi-api-key'],
  },
  fish: {
    host: 'https://api.fish.audio',
    paths: [/^\/model$/, /^\/model\/[^/?#]+$/, /^\/v1\/tts$/],
    headers: ['authorization', 'model'],
  },
};

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  const engine = String(req.query.engine || '');
  const path = String(req.query.path || '');
  const up = UPSTREAMS[engine];

  if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).json({ message: 'method not allowed' });
  if (!up || path.includes('..') || !up.paths.some(re => re.test(path))) return res.status(400).json({ message: 'target not allowed' });

  // 只接受本站页面发来的请求
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (e) {}
    if (host !== req.headers.host) return res.status(403).json({ message: 'cross-site request refused' });
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);

  const headers = {};
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  up.headers.forEach(h => { if (req.headers[h]) headers[h] = req.headers[h]; });

  try {
    const r = await fetch(up.host + path, { method: req.method, headers, body: body.length ? body : undefined });
    res.status(r.status);
    res.setHeader('content-type', r.headers.get('content-type') || 'application/octet-stream');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(502).json({ message: 'upstream unreachable: ' + e.message });
  }
};
