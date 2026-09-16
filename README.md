# justEMT

爱蜜莉雅主题个人站，当前基于 **Next.js 16 App Router + React 19 + TypeScript + Tailwind CSS 4**。

主要功能包括：沉浸式首页、瀑布流画廊、R2 管理上传、AI 对话、Tavern 角色实验页、受保护博客、匿名来访统计，以及可选音乐播放器。

## 技术架构

```text
src/
├── app/                  # Next.js App Router
│   ├── (content)/        # 博客、画廊、来访等内容页面
│   ├── (immersive)/      # 首页、登录等沉浸式页面
│   ├── (wide)/           # Chat / Tavern / Music
│   └── api/              # Route Handlers
├── components/           # React 客户端/服务端组件
├── content/              # 仓库内 Markdown / YAML 内容
├── data/
└── lib/                  # 鉴权、R2、Redis、AI、配额等服务端模块
```

部署目标为 Vercel，`vercel.json` 已声明 `framework: nextjs`。

## 开发

需要 Node.js 20.9+。

```bash
npm ci
npm run dev
```

常用检查：

```bash
npm run typecheck
npm run build
npm run check
```

`npm run check` 会依次执行 TypeScript 类型检查和生产构建。仓库的 GitHub Actions 会在 Pull Request 上自动执行相同的核心验证。

## 环境变量

复制 `.env.example` 为 `.env`，本地填写真实值；Vercel 上在项目的 Environment Variables 中配置。

最重要的生产变量：

```dotenv
BLOG_PASSWORD=
AUTH_SECRET=
CHAT_PASSWORD=

UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_URL=
```

不要把真实密钥提交到 Git。`.env*` 已被忽略，仅 `.env.example` 作为模板保留。

## 鉴权与限流

博客、画廊管理和来访记录重置使用签名 HttpOnly Cookie。生产环境必须设置随机、足够长的 `AUTH_SECRET`；代码不会在生产环境回落到公开的开发密钥。

登录防爆破使用共享固定窗口限流：每个客户端 IP 每分钟最多 10 次尝试。配置 Upstash 后限流跨 Vercel 实例共享；如果已经配置 Redis 但 Redis 临时故障，鉴权限流会 fail closed，而不是静默退化为单实例保护。

AI 与 Tavern 共用同一个 burst limiter：

- 匿名：5 次/分钟；
- 已登录：20 次/分钟；
- 匿名日配额默认全站合计 30 次，`AI_DAILY_LIMIT` 最大 100；
- 已登录会话不消耗匿名日配额，但仍受 burst limiter 保护。

音乐公开代理每 IP 每分钟最多 12 次，同时继续受 `MUSIC_DAILY_LIMIT` 的全站上游配额保护。

## AI 对话

`/chat` 为稳定对话页，`/tavern` 为角色状态/长期记忆结构的实验页。

AI 密钥只在 Route Handler 中使用，不会下发到浏览器。聊天正文保存在浏览器 `localStorage`，服务端不会持久化消息。

上游只要求兼容 OpenAI 风格 `/chat/completions` 流式协议，可配置 OpenAI、DeepSeek、Moonshot、OpenRouter 或兼容网关。

Tavern v1 当前仍是浏览器持有 Persona / State / Memory 的 PoC；服务端会校验结构和长度，但这些状态还不是服务端权威状态机。后续设计见 `docs/chat-architecture.md`。

## 博客与私密文章

文章位于：

```text
src/content/blog/*.md
```

Frontmatter 中设置：

```yaml
private: true
```

即可把文章标记为私密。

未登录用户：

- 不会在博客列表看到私密文章；
- 直接访问正文会跳转登录页；
- Metadata 不会暴露私密文章标题和摘要，并设置 `noindex/noarchive`。

博客 Markdown 来自仓库内受信任内容，当前由 `marked` 转换后渲染。如果未来开放后台投稿，必须在渲染前增加 HTML sanitizer。

## 画廊与 Cloudflare R2

画廊支持两种来源：

1. 仓库内容：`src/content/gallery/*.yaml` + `public/gallery/`；
2. R2 远程馆藏：通过 `/gallery/manage` 管理。

上传流程：

```text
浏览器计算 SHA-256
  → 服务端签发短时 PUT URL
  → 浏览器直传 gallery/staging/<uuid>/
  → 服务端校验大小与原图 SHA-256
  → R2 内复制为正式 originals / previews / thumbnails
  → 基于 manifest ETag 条件写入 gallery/manifest.json
  → 删除 staging 对象
```

Manifest 更新使用 R2 `If-Match / If-None-Match` 条件写和重试，避免多实例并发上传/删除时发生 lost update。

### R2 生命周期规则

建议在 Cloudflare R2 为前缀：

```text
gallery/staging/
```

配置 **1 天后自动删除** 的生命周期规则。这样用户拿到预签名 URL 后中途关闭页面产生的 staging 孤儿对象会自动清理，而正式馆藏不受影响。

R2 CORS 至少允许站点域名和本地 Next.js 开发地址执行 `PUT`：

```json
[
  {
    "AllowedOrigins": [
      "https://你的站点域名",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Cache-Control"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## 来访雪笺

公开页面记录匿名来访：

- Cookie 使用随机 UUID，但 Redis 内部身份键使用其 SHA-256 摘要；
- 完整 IP 不写入公开记录，只保存脱敏后的显示值；
- 同一访客 30 分钟内连续浏览只记作一次来访；
- 今日统计使用短期 TTL；
- `totalVisitors` / `totalVisits` 为真正的永久累计计数，不再一年后自动归零。

生产环境建议配置 Upstash；不配置时会回落到当前 Serverless 实例内存，统计只能视为尽力而为。

如果项目从 Vercel 迁到自建反向代理，可通过 `TRUSTED_IP_HEADER` 指定由代理覆盖、客户端无法伪造的真实 IP 请求头。

## 安全响应头

Next.js 全局响应目前设置：

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- 限制 Camera / Microphone / Geolocation / Payment / USB 的 `Permissions-Policy`
- `Cross-Origin-Opener-Policy: same-origin`

完整 CSP 暂未强制启用，因为 Next.js hydration 与现有首屏主题脚本需要先设计 nonce 策略；该事项记录在审计文档中，不应简单通过 `unsafe-inline` 形式草率上线。

## 审计与维护

本轮 Next.js 迁移后的系统审计记录：

```text
docs/audit-2026-09.md
```

其中记录已修复问题、仍保留的风险、验证方法和后续优先级。
