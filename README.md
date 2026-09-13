# justEMT

爱蜜莉雅主题站：沉浸式首页、瀑布流画廊、AI 对话、受保护博客和可选音乐播放器。

## 来访雪笺

公开页面会记录匿名来访，并在最近足迹中显示经过脱敏的 IP（IPv4 后两段、IPv6 后四段替换为 `*`），不保存完整 IP、设备信息或个人资料。记录的是“有人来访”而不是每次翻页：同一匿名访客 30 分钟内的连续浏览只记一次，`path` 保存这次来访的入口页面，站内切换页面不会新增记录。导航栏的“来访”入口可以查看累计访客、今日访客、来访次数、网站运行时间和最近 100 条足迹。

“来访”页面右上角的“重置记录”需要输入与博客相同的暗号（`BLOG_PASSWORD`），验证通过后只清空最近足迹列表，累计访客、累计来访次数与今日统计都会保留，所以计数会从原值继续往上走。

记录优先使用 Upstash Redis；未配置 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 时会回落到当前实例内存，适合本地开发但不适合多实例生产统计。网站运行时间默认从项目首次提交时间计算，可通过 `SITE_LAUNCHED_AT` 覆盖。

## AI 对话

`/chat` 是公开页面，和爱蜜莉雅聊天。对话内容只存在浏览器 `localStorage` 里，服务端不保存任何消息，`AI_API_KEY` 也只在服务端使用，不会下发到前端。

次数限制是**全站每天合计 N 次**，不是每人 N 次 —— 页面公开，匿名访客无法可靠区分，只能靠总量止损。`AI_DAILY_LIMIT` 默认 30，上限硬顶 100（配得更高也会被钳到 100）；填非法值或 0 会回落到默认值。按北京时间日切，与站点其他统计一致。用完之后登录（同 `BLOG_PASSWORD`）即可继续，登录会话不计次也不受限。

只要求上游兼容 `/chat/completions` 的流式协议，所以 OpenAI、DeepSeek、Moonshot、OpenRouter、自建网关都能用，区别只在 `AI_BASE_URL` 和 `AI_MODEL`：

```dotenv
AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
# 人物设定，留空用内置的爱蜜莉雅设定
AI_SYSTEM_PROMPT=
# 未登录访客每天合计次数，默认 30，最多 100
AI_DAILY_LIMIT=30
```

留空 `AI_API_KEY` 时页面只显示「服务尚未连接」，不会发出请求。

两个部署上的注意点：

- 流式响应期间 Vercel 函数一直在跑，`astro.config.mjs` 里的 `maxDuration` 必须大于 `src/lib/chat.ts` 的 `TIMEOUT_MS`（现为 60s > 55s），否则平台先杀掉函数，超时和退还配额的逻辑都来不及执行。Hobby 默认只有 10~15 秒，长回答会被掐断。
- 计数走共享存储：配了 Upstash Redis 才是全站精确的；没配会回落到进程内存，每个实例各算一份，只是软上限。

## 博客访问权限

博客已加入导航栏。文章 frontmatter 中的 `private` 默认为 `false`，公开文章可直接访问；需要鉴权的文章设置为：

```yaml
private: true
```

未登录用户不会看到私有文章的列表项，直接打开私有文章链接会跳转到登录页。

## 开发

```sh
npm install
npm run dev
npm run astro -- check
npm run build
```

## 画廊与 Cloudflare R2

画廊现在支持两种来源：

- 未配置 R2 时，读取 `src/content/gallery/*.yaml` 和 `public/gallery/`，现有站点行为不变。
- 配置 R2 后，`/gallery/manage` 可批量选择图片。浏览器会生成 WebP 预览图/缩略图并直传 R2，图片清单保存在 `gallery/manifest.json`；R2 图片与仓库里的 YAML 内容会合并显示，方便逐步迁移。

Vercel 环境变量：

```dotenv
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_URL=https://img.example.com
```

管理页复用博客登录会话，因此还需要配置 `BLOG_PASSWORD` 和 `AUTH_SECRET`。登录后访问 `/gallery/manage`。

Cloudflare 控制台需要完成：

1. 创建 R2 bucket，例如 `justemt-gallery`。
2. 创建限定到这个 bucket 的 **Object Read & Write** API Token，将 Access Key ID 和 Secret Access Key 填入 Vercel。
3. 给 bucket 绑定公开自定义域名，例如 `img.example.com`，将该域名填入 `R2_PUBLIC_URL`。`r2.dev` 仅建议用于测试。
4. 配置 bucket CORS，允许站点域名和本地开发端口执行 `PUT`，并允许 `Content-Type`、`Cache-Control` 请求头：

```json
[
  {
    "AllowedOrigins": [
      "https://你的站点域名",
      "http://localhost:4321"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Cache-Control"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

5. 部署后打开 `/gallery/manage`，选择图片上传。上传完成后可删除仓库里的旧图片和对应 YAML；删除前建议先确认 R2 画廊显示正常。

R2 官方文档：

- [S3 API 凭据](https://developers.cloudflare.com/r2/api/s3/tokens/)
- [公开 bucket 与自定义域名](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [CORS](https://developers.cloudflare.com/r2/buckets/cors/)
