/**
 * 模拟 Upstash Redis REST 的 /pipeline 端点，用于本地验证 store.ts 的
 * 命令构造与响应解析。只实现用到的几条命令。
 * 用法：node scripts/mock-upstash.mjs [port]
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8079);
/** key -> { value: string, expiresAt: number | null } */
const db = new Map();

const alive = (k) => {
  const e = db.get(k);
  if (!e) return null;
  if (e.expiresAt !== null && Date.now() > e.expiresAt) {
    db.delete(k);
    return null;
  }
  return e;
};

function exec([cmd, ...args]) {
  switch (String(cmd).toUpperCase()) {
    case 'INCR': {
      const e = alive(args[0]);
      const next = Number(e?.value ?? 0) + 1;
      db.set(args[0], { value: String(next), expiresAt: e?.expiresAt ?? null });
      return next;
    }
    case 'DECR': {
      const e = alive(args[0]);
      const next = Number(e?.value ?? 0) - 1;
      db.set(args[0], { value: String(next), expiresAt: e?.expiresAt ?? null });
      return next;
    }
    case 'EXPIRE': {
      const [key, ttl, flag] = args;
      const e = alive(key);
      if (!e) return 0;
      // NX：仅在当前没有过期时间时才设置
      if (String(flag).toUpperCase() === 'NX' && e.expiresAt !== null) return 0;
      e.expiresAt = Date.now() + Number(ttl) * 1000;
      db.set(key, e);
      return 1;
    }
    case 'GET': {
      const e = alive(args[0]);
      return e ? e.value : null;
    }
    case 'SET': {
      const [key, value, ex, ttl] = args;
      const expiresAt =
        String(ex).toUpperCase() === 'EX' ? Date.now() + Number(ttl) * 1000 : null;
      db.set(key, { value: String(value), expiresAt });
      return 'OK';
    }
    default:
      throw new Error(`未实现的命令: ${cmd}`);
  }
}

createServer((req, res) => {
  if (!req.url?.endsWith('/pipeline')) {
    res.writeHead(404).end('not found');
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let out;
    try {
      out = JSON.parse(body).map((cmd) => {
        try {
          return { result: exec(cmd) };
        } catch (err) {
          return { error: String(err.message) };
        }
      });
    } catch (err) {
      res.writeHead(400).end(String(err));
      return;
    }
    console.log(JSON.stringify(JSON.parse(body)), '->', JSON.stringify(out));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
  });
}).listen(port, () => console.log(`mock upstash on http://127.0.0.1:${port}`));
