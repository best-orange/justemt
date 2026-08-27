# justEMT

爱蜜莉雅主题站：沉浸式首页、瀑布流画廊、受保护博客和可选音乐播放器。

## 来访雪笺

公开页面会记录匿名来访，并在最近足迹中显示经过脱敏的 IP（IPv4 后两段、IPv6 后四段替换为 `*`），不保存完整 IP、设备信息或个人资料。记录的是“有人来访”而不是每次翻页：同一匿名访客 30 分钟内的连续浏览只记一次，`path` 保存这次来访的入口页面，站内切换页面不会新增记录。导航栏的“来访”入口可以查看累计访客、今日访客、来访次数、网站运行时间和最近 100 条足迹。

“来访”页面右上角的“重置记录”需要输入与博客相同的暗号（`BLOG_PASSWORD`），验证通过后只清空最近足迹列表，累计访客、累计来访次数与今日统计都会保留，所以计数会从原值继续往上走。

记录优先使用 Upstash Redis；未配置 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 时会回落到当前实例内存，适合本地开发但不适合多实例生产统计。网站运行时间默认从项目首次提交时间计算，可通过 `SITE_LAUNCHED_AT` 覆盖。

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
