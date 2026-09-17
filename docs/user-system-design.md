# 用户体系设计方案

状态：待确认 · 2026-09-17

## 1. 目标与范围

把现在的「成绩归属 = 规范化后的名字」改成「成绩归属 = 孩子档案 ID」，同时引入家长账号做登录。

已拍板的前提：

- 两层模型：**Account（家长，持登录身份）→ Player（孩子，只有名字）**
- 自己接 Google OAuth，**不引入 Supabase**，后端继续用 Render 挂载盘上的 JSON 文件
- **先只做 Google**，provider 字段预留 Apple
- Top 5 **保持全局榜不变**，每行背后挂 `playerId`
- 老成绩**直接清空**，不迁移
- 交互上**不再每次输入姓名**，改为选择已有的孩子

不做的事：密码登录、邮箱验证、找回密码、多设备强制下线、付费/配额。

## 2. 数据模型

### Account（家长）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | uuid |
| `provider` | `'google' \| 'apple'` | 先只有 google |
| `providerSub` | string | Google 的 `sub`，与 provider 组成唯一键 |
| `email` | string | 仅用于展示与对账，不下发给榜单 |
| `displayName` | string | Google 返回的姓名 |
| `createdAt` / `lastLoginAt` | number | 时间戳 |

### Player（孩子）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | uuid |
| `accountId` | string | 归属 |
| `familyName` / `givenName` | string | 沿用现有全大写规则 |
| `nameKey` | string | `WANG YANYI`，仅用于显示与老数据兜底 |
| `avatarSeed` | string | 决定头像底色 |
| `createdAt` | number | |

**孩子档案不保存任何身份信息** —— 没有邮箱、没有第三方 ID、没有设备标识。这是刻意设计：真实身份只挂在家长账号上，规避儿童个人信息合规风险。

### ScoreEntry（改动）

现有字段全部保留（`id / name / nameKey / score / createdAt / dedupeKey / analysisKey`），新增两个可选字段：

- `playerId`：归属的孩子
- `accountId`：冗余存一份，便于按账号统计

**榜单去重 key 从 `nameKey` 改为 `playerId ?? nameKey`**，没有 `playerId` 的老记录仍能正常排名。

## 3. 认证流程

Google 已不支持隐式流，必须走 **Authorization Code + PKCE**：

```
App            Google            后端 Express
 │──授权请求(PKCE challenge)──▶│
 │◀──authorization code────────│
 │──code + codeVerifier────────────────────▶│
 │                              │──换 token (含 client_secret)──▶│ Google
 │                              │◀──id_token (JWT)──────────────│
 │                              │ 验签 + 校验 aud / iss / exp
 │                              │ 按 (provider, sub) 查建 Account
 │                              │ 签发自己的 sessionToken (HMAC)
 │◀──sessionToken + account────│
```

要点：

- `client_secret` 只存在于后端，前端拿不到
- 后端用 Google JWKS 验 `id_token` 签名（装 `jose`），校验 `aud` 等于自己的 client id、`iss` 为 Google、`exp` 未过期
- 验完后**签发自己的 session token**（HMAC-SHA256，node 内置 crypto，零依赖），有效期 90 天；前端存 `expo-secure-store`
- 后续所有请求带 `Authorization: Bearer <sessionToken>`，后端中间件解出 `accountId`
- 不用 Google 的 `tokeninfo` 端点：多一次网络往返且有频率限制

## 4. 接口清单

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/google` | 入参 `{ code, codeVerifier, redirectUri }`，返回 `{ sessionToken, account }` |
| GET | `/api/auth/me` | 返回 `{ account, players }`，同时用于启动时恢复会话 |
| POST | `/api/auth/logout` | 失效当前 session |
| GET | `/api/players` | 当前账号下的孩子列表（含每人最高分） |
| POST | `/api/players` | 入参 `{ familyName, givenName }`；同名返回已有档案并带 `alreadyExists` 标记，由前端确认 |
| GET | `/api/players/:id/scores` | 某个孩子的全部成绩，用于个人历史 |
| PATCH | `/api/players/:id` | 改名（不做删除，避免成绩变孤儿） |
| POST | `/api/scores` | 改为入参 `{ playerId, score, analysisKey }`，`name` 由后端从档案取（**当前仍接受调用方传 name**，等鉴权中间件落地后收紧） |
| GET | `/api/scores` | 全局榜，保持现有响应，每行增加 `playerId` |
| GET | `/api/scores/highlight/:entryId` | 不变 |

## 5. 后端改造

新增文件（照 `persistence.ts` 的写法，读写 JSON + 原子写）：

- `src/utils/authStore.ts` — `accounts.json` / `players.json` / `sessions` 读写
- `src/utils/googleAuth.ts` — 换 token、验签 id_token
- `src/utils/session.ts` — HMAC 签发与校验
- `src/middleware/requireAccount.ts` — 解析 Bearer，注入 `accountId`
- `src/routes/auth.ts` / `src/routes/players.ts`

改造文件：

- `persistence.ts` — `ScoreEntry` 加字段；`bestScorePerPlayer` 的归并 key 改为 `playerId ?? nameKey` **✅ 已完成**
- `routes/scores.ts` — POST 校验 `playerId` 属于当前账号；GET 每行带 `playerId`（**部分**：已接受并透传 `playerId`，归属校验等鉴权中间件）
- `index.ts` — 注册新路由与新迁移（`legacyScoreReset` 已挂上）

环境变量（Render 后台配置）：

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET`
- `ALLOWED_REDIRECT_URIS`（可选白名单）

新增依赖：后端 `jose`；前端 `expo-auth-session`、`expo-web-browser`、`expo-secure-store`。

## 6. 前端流程

冷启动分支：

```
无 session            → SignInScreen
有 session，无 player  → 建档（沿用 Family / Given 全大写规则）
有 session，1 个 player → 直接进 Home
有 session，多个       → PlayerPicker 选人
```

Home 的变化：

- 顶部新增当前孩子条：头像 + 名字 + `Switch`
- hero「Rank now?」直接进录制，**不再弹姓名输入**
- `Switch` / 头像 → 打开选孩子面板（含 `Add a player`）

其余屏幕（Record / TargetSelect / Result）逻辑不变，只是参数从 `playerName: string` 换成 `playerId: string` + 名字。Result 页的 PersonalStanding 判定改为按 `playerId` 统计。

## 7. 数据迁移

### 已完成的前置改造（不依赖 Google 凭据，已提交）

| 文件 | 内容 |
|---|---|
| `persistence.ts` | `ScoreEntry` 新增可选 `playerId` / `accountId`；新增 `playerIdentityKey()`，榜单归并、同分截图选取、名次判定、去重 key 全部改为 `playerId ?? nameKey` |
| `routes/scores.ts` | POST 接受可选 `playerId` / `accountId`，非字符串返回 400 |
| `utils/legacyScoreReset.ts` | 新增：删掉没有 `playerId` 的记录及其截图 |

成效：**同名不再是同一个人**。同一个名字挂不同 `playerId` 的多条记录现在是榜单上独立的多行；同一段视频同一个点给两个孩子打分，会存成两条而不是互相覆盖。老记录（无 `playerId`）行为完全不变。

### 老数据清理

不沿用 v1「一律清空」的写法，改成精确删除：

- **只删没有 `playerId` 的记录**，已归入档案的即使开关开着也保留
- **由环境变量 `CLEAR_LEGACY_SCORES=true` 触发**，默认关闭 —— 避免把正在用的榜单清掉
- flag 文件 `.scores-cleared-v2` 保证只跑一次
- 连带删除这些记录对应的 `highlights/` 截图

上线登录版那次部署时把这个变量配上即可。不现在就清的原因：当前的 APK 写的仍是无主记录，提前清完过几天又要再清一轮。

`accounts.json` 与 `players.json` 从空开始。

## 8. 需要你在 Google Cloud 完成的配置

1. 建或选一个 Google Cloud 项目
2. 配 OAuth 同意屏幕：应用名填 `PingPong Star`，填支持邮箱；**保持 Testing 状态**，把家人的 Gmail 加进测试用户（这样不需要 Google 审核）
3. 创建凭据 → **OAuth 客户端 ID → Web application**（这一步会同时给出 client id 与 client secret，两个都要给后端）
4. 已获授权的重定向 URI 填：
   - `https://auth.expo.io/@yqwang2c/pingpong-star`（开发/Expo Go）
   - `pingpongstar://redirect`（正式包，如后续要加自定义 scheme）
5. 若要原生体验，再建一个 **Android** 类型的客户端 ID：包名 `com.yqwang2c.pingpongstar`，SHA-1 用 `eas credentials -p android` 查；本期可以不做，走 Web 流程即可

把 **Web Client ID 和 Client Secret** 发我即可开工。

## 9. 风险与后续

- **Google 登录由家长操作**，符合 Google 的年龄要求；孩子只用档案名，不单独注册
- 若将来上架 Google Play 且定级为儿童向，需要过 Play Families 政策；目前没有广告与分析 SDK，风险低
- Apple 登录需要付费的 Apple Developer 账号（Service ID 与 .p8 私钥都在付费账号后台），本期只预留字段
- JSON 文件在多账号并发写下有理论上的竞态；当前用户量可忽略，若日后变多再考虑 SQLite
- 删除孩子档案暂不开放，只支持改名，避免成绩变孤儿
