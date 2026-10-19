# 单词卡 WordCard

个人英语单词卡 PWA（按 `word_card/vocab_card_pwa_mvp_prd.md` 实现）。

- **web/** — React + TypeScript + Vite PWA。数据全部在本机 IndexedDB（Dexie），
  支持离线翻阅、三种浏览模式（随机混合 / 时间顺序 / FSRS 复习）、本地中英文搜索。
- **proxy/** — Node.js API 代理。服务端持有模型 API Key 与共享访问码，
  只转发 AI 生成与 OCR 请求，不保存任何词库或照片。

## 本地开发

```bash
# web (default port 5173)
cd web
cp .env.example .env.local       # 本地指向 http://localhost:8787
npm install
npm run dev

# proxy (port 8787)
cd proxy
cp .env.example .env            # 填入你的模型 Base URL / Key / 访问码
npm install
npm run dev
```

本地端到端联调可以用 mock 上游：`node proxy/scripts/mock-upstream.mjs`（:9911），
再以 `MODEL_BASE_URL=http://localhost:9911 MODEL_SUPPORTS_VISION=true ...` 启动 proxy。

测试：`npm test`（web 51 个用例，proxy 14 个用例）。

## 部署

### 1. 前端 → GitHub Pages

1. 在 GitHub 新建**公开**仓库（例如 `vocab-card`），把本目录（vocab-card/）
   的内容作为仓库根目录推送。
2. 仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。
3. 在仓库 Settings → Secrets and variables → Actions → Variables 添加：
   - `VITE_BASE` = `/vocab-card/`（与仓库名一致；如用自定义域名则 `/`）
   - `VITE_API_PROXY_URL` = `https://api.yourdomain.com[:8443]`（不是秘密）
4. push 到 main 即自动构建部署（`.github/workflows/deploy.yml`）。

iPhone 安装：Safari 打开 Pages 地址 → 分享 → 添加到主屏幕。

### 2. 代理 → 阿里云服务器

```bash
# 1. 在开发机构建（需要 devDependencies 的 tsc）
cd proxy
npm run build                     # 生成 dist/

# 2. 上传到服务器（示例路径 /opt/vocab-card-proxy）
rsync -av --exclude node_modules --exclude .env \
  proxy/ youruser@server:/opt/vocab-card-proxy/

# 3. 服务器上安装生产依赖并配置
cd /opt/vocab-card-proxy
npm ci --omit=dev               # 只装 express/zod/busboy
cp .env.example .env            # 填入真实值；chmod 600，不要提交
```

`.env` 需要的真实值（全部只在服务端）：

| 变量 | 说明 |
|---|---|
| `MODEL_BASE_URL` / `MODEL_NAME` | 你的 OpenAI 兼容服务地址与模型名 |
| `MODEL_SUPPORTS_VISION` | 模型支持图片输入则 `true`（拍照 OCR 走同一模型） |
| `MODEL_API_KEY` | 模型 Key |
| `APP_SHARED_ACCESS_CODE` | 给朋友共用的访问码 |
| `ALLOWED_ORIGIN` | Pages 站点 origin，如 `https://xxx.github.io` |

TLS（浏览器要求代理必须是 HTTPS）：

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo cp deploy/nginx-vocab-card.conf /etc/nginx/sites-available/vocab-card
sudo ln -s /etc/nginx/sites-available/vocab-card /etc/nginx/sites-enabled/
# 编辑 conf：替换 api.yourdomain.com 为你的域名
sudo certbot certonly --nginx -d api.yourdomain.com     # 或 DNS-01
sudo nginx -t && sudo systemctl reload nginx
```

> 域名需 A 记录指向服务器 IP。**若服务器在中国大陆**，未备案域名走 80/443
> 会被阻断：保持示例中的 8443 非标准端口（并在阿里云安全组放行 8443），
> `VITE_API_PROXY_URL` 使用 `https://api.yourdomain.com:8443`。

systemd 常驻：

```bash
sudo cp deploy/vocab-card-proxy.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vocab-card-proxy
curl https://api.yourdomain.com:8443/api/v1/health
```

## 安全要点（实现于代码中）

- 模型 API Key / 访问码只在代理端环境变量中；前端 bundle 不含任何密钥。
- 代理逐请求校验共享访问码（timing-safe 比较），按 IP 限流（生成 20 次/分，
  OCR 5 次/分），CORS 限定 Pages origin，JSON 体积上限 64 KB。
- 图片仅在请求生命周期内处理，不落盘、不记日志。
- iPhone 端词库仅存于本机 IndexedDB；清除网站数据会丢失词库（第一版无备份）。
