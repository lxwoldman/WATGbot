# Broker Console Backend

这是一版已经把前端控制台、`whatsapp-web.js`、`Telegram UserBot` 和动态绑定跑通的中控台项目。

## 已实现

- `Express + Socket.IO` 服务端
- `whatsapp-web.js` 驱动的 `WhatsApp Web` 接管链路
- `GramJS` 驱动的 `Telegram UserBot` 会话接管与发信骨架
- 当前交易单 / 资源配置 / 回执文本 / 缺口计算 的内存态服务
- `REST API` 与静态托管
- `WhatsApp` 发送队列、随机抖动、自动重连、熔断与状态观测
- 控制台状态自动落盘，重启后恢复交易单、源头绑定、资源绑定和日志
- `WhatsApp` 已发现会话自动落盘，重启后保留最近聊天候选
- 最小访问保护、共享配置服务端化、审计日志落盘

## 当前 WhatsApp 方案

当前仓库生产主链路使用 `whatsapp-web.js`，服务端会持久化会话、发现列表和控制台状态；登录和日常发信都走当前接好的浏览器接管方案。

## 快速开始

1. 安装依赖

```bash
npm install
```

2. 复制环境变量

```bash
cp .env.example .env
```

3. 启动服务

```bash
npm run dev
```

4. 打开页面

```text
http://localhost:3000/index.html
```

## 部署

团队私网部署请直接看：

- [DEPLOYMENT.md](/Users/imlxw/Desktop/业务调度系统/DEPLOYMENT.md)

## 主要接口

### 健康检查

`GET /api/health`

### 获取前端启动数据

`GET /api/bootstrap`

### 状态持久化

- 默认文件：`.data/console-state.json`
- 自动保存交易单、源头/资源绑定与操作日志
- 进程收到 `SIGINT / SIGTERM` 时会主动 flush 一次

### WhatsApp Baileys 管理

- `GET /api/integrations/whatsapp/status`
- `GET /api/integrations/whatsapp/chats`
- `POST /api/integrations/whatsapp/connect`

二维码模式：

```json
{
  "mode": "qr"
}
```

配对码模式：

```json
{
  "mode": "pairing_code",
  "phoneNumber": "8613812345678"
}
```

- `POST /api/integrations/whatsapp/reconnect`
- `POST /api/integrations/whatsapp/logout`

### Telegram UserBot 管理

- `GET /api/integrations/telegram-userbot/status`
- `GET /api/integrations/telegram-userbot/dialogs`
- `POST /api/integrations/telegram-userbot/request-code`

```json
{
  "phoneNumber": "+8613812345678"
}
```

- `POST /api/integrations/telegram-userbot/complete-login`

```json
{
  "phoneCode": "12345"
}
```

如果账号开启了二次验证，再调用一次并带上密码：

```json
{
  "password": "your-2fa-password"
}
```

- `POST /api/integrations/telegram-userbot/logout`

### 更新当前交易单

`PATCH /api/ticket/current`

示例：

```json
{
  "league": "韩国K甲组联赛",
  "teams": "江原 v 安阳",
  "marketText": "小 2 / 2.5 @ 0.90",
  "deliveryTarget": 15000,
  "internalTarget": 2000
}
```

### 更新资源

`PATCH /api/resources/:resourceId`

### 更新源头绑定

`PATCH /api/source-channels/:sourceChannelId`

### 回复源头

`POST /api/actions/source-reply`

```json
{
  "text": "1"
}
```

### 广播预备单

`POST /api/actions/broadcast-prep`

### 广播盘口

`POST /api/actions/broadcast-market`

### 单资源发送

`POST /api/actions/resources/:resourceId/:kind`

`kind` 支持：

- `prep`
- `market`
- `receipt`

## 下一步最值得做

1. 用真实数据库替换当前 JSON 持久层
2. 在登录成功后补首轮真实通道发现和绑定校验
3. 完善资源路由规则，不再用 `league.includes("阿根廷")` 这种占位逻辑
4. 给发送动作补审计表、失败重试和人工确认队列
5. 给控制台补鉴权和操作审计
