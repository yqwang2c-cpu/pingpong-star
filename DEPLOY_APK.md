# PingPong Star 部署与 APK 打包

## 1. 后端部署到 Render

这个仓库已经补好了 `render.yaml` 和 `server/Dockerfile`，可直接作为 Render Blueprint / Docker 服务使用。

### 步骤

1. 把当前仓库推到 GitHub。
2. 登录 Render。
3. 选择 `New -> Blueprint`，连接这个仓库。
4. Render 会识别根目录下的 `render.yaml`。
5. 在环境变量里填写：
   - `DASHSCOPE_API_KEY`: 你的通义千问 API Key
6. 点击部署，等待服务上线。
7. 打开健康检查地址：

```text
https://你的-render-域名/health
```

如果返回 `status: ok`，说明后端已上线。

### 重要说明

- Render 默认提供的是公网域名，不是固定公网 IP。
- 这个项目当前用 `server/scores.json` 保存排行榜；在云容器重建或重启后，数据可能丢失。
- 如果后面要长期使用，建议把排行榜改成数据库。

## 2. 前端改成连接云端地址

前端已经改成读取根目录 `.env` 中的：

```env
EXPO_PUBLIC_API_URL=https://你的-render-域名
```

可直接复制：

```bash
cp .env.example .env
```

然后把 `.env` 里的地址改成你后端上线后的公网地址。

## 3. 生成 APK

当前项目的 `eas.json` 已经有 `preview` 配置，会产出 APK。

### 方式 A：EAS 云构建

适合已经有 Expo / EAS 账号的情况。

```bash
npx eas login
npx eas build --platform android --profile preview
```

构建完成后，Expo 会给出 APK 下载链接。

### 方式 B：EAS 本地构建

适合本机已经安装完整 Android / Java 构建环境的情况。

```bash
npx eas build --platform android --profile preview --local
```

## 4. 推荐执行顺序

1. 先部署后端到 Render。
2. 拿到 Render 公网域名。
3. 修改根目录 `.env` 的 `EXPO_PUBLIC_API_URL`。
4. 再执行 APK 打包。

这样打出来的 APK 会直接连接云端后端服务。
