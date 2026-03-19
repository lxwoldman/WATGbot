# 部署手册

## 当前推荐拓扑

当前版本最适合先部署成一台**中心值班机**：

- `Node.js` 服务、`WhatsApp` 会话、`Telegram UserBot` 会话全部跑在同一台云主机
- 团队成员通过 `Tailscale` 私网访问同一个地址
- 不直接暴露公网，不先上 `Nginx / 域名 / HTTPS`

这个方案的原因很简单：

- `whatsapp-web.js + Puppeteer` 需要长期在线的进程和本地持久化目录
- 你们是轮班制，不是多人同时操作，所以“同一台中心主机”比“每人一套”更稳
- 当前代码已经补上了基础访问保护、共享配置落盘和审计日志，更适合先做内测私网版

## 部署前已经补上的维护项

- 服务端最小访问保护：支持 `Basic Auth`
- 共享配置服务端化：汇率、特殊赛额度、跟注额、美洲开关、快捷指令改为跟随服务端状态
- 资源币种入库：`U / RMB` 不再只在浏览器本地保存
- 审计日志：关键发送、绑定、删除、登录操作会追加到 `.data/audit-log.ndjson`

## 主机建议

优先建议：

1. `Oracle Cloud` 免费云主机
2. `Ubuntu 22.04 LTS`
3. 尽量选 `x86_64 / AMD / Intel` 机型

原因：

- `whatsapp-web.js` 依赖 `Puppeteer`，在 `x86_64 Ubuntu` 上最省心
- `ARM` 也不是完全不能跑，但浏览器依赖兼容性更容易折腾

如果免费区抢不到 `x86_64`，再退一步尝试 `Ampere A1`。

## 目录约定

部署文档默认使用：

- 项目目录：`/opt/watgbot`
- 运行用户：`ubuntu`
- systemd 服务名：`watg-console`

## 一次性部署步骤

### 1. 把代码放上服务器

```bash
sudo mkdir -p /opt/watgbot
sudo chown -R ubuntu:ubuntu /opt/watgbot
git clone https://github.com/lxwoldman/WATGbot.git /opt/watgbot
cd /opt/watgbot
```

### 2. 安装系统依赖

```bash
cd /opt/watgbot
chmod +x deploy/ubuntu/bootstrap.sh
sudo APP_DIR=/opt/watgbot APP_USER=ubuntu ./deploy/ubuntu/bootstrap.sh
```

### 3. 填写生产环境变量

```bash
cd /opt/watgbot
cp deploy/.env.production.example .env
```

最少要填：

- `APP_BASE_URL`
- `CONSOLE_AUTH_USERNAME`
- `CONSOLE_AUTH_PASSWORD`
- `WHATSAPP_DEFAULT_PAIRING_PHONE`
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_SECRET`

### 4. 注册 systemd 服务

```bash
cd /opt/watgbot
chmod +x deploy/ubuntu/backup-state.sh
sudo cp deploy/ubuntu/watg-console.service /etc/systemd/system/watg-console.service
sudo systemctl daemon-reload
sudo systemctl enable --now watg-console
sudo systemctl status watg-console --no-pager
```

### 5. 加入 Tailscale 私网

```bash
sudo tailscale up
tailscale ip -4
```

完成后，用团队成员都能访问的 Tailscale 地址打开：

```text
http://<tailscale-ip>:3000/index.html
```

浏览器会先弹出账号密码验证框，这里输入 `.env` 里的：

- `CONSOLE_AUTH_USERNAME`
- `CONSOLE_AUTH_PASSWORD`

### 6. 首次登录 WhatsApp / Telegram

服务启动后：

1. 打开控制台页面
2. 先用页面里的按钮完成 `WhatsApp / Telegram` 登录
3. 登录成功后，`.sessions/` 会写入会话文件
4. 后续重启只要会话没失效，一般不需要重新扫

## 备份建议

最少备份这三类：

- `.env`
- `.data/`
- `.sessions/`

手动备份：

```bash
cd /opt/watgbot
APP_DIR=/opt/watgbot ./deploy/ubuntu/backup-state.sh
```

可以加一个每天凌晨的 cron：

```bash
crontab -e
```

加入：

```cron
15 4 * * * APP_DIR=/opt/watgbot /opt/watgbot/deploy/ubuntu/backup-state.sh >> /var/log/watg-backup.log 2>&1
```

## 上线后建议保留的运维动作

查看服务日志：

```bash
sudo journalctl -u watg-console -f
```

查看最近审计：

```bash
tail -n 50 /opt/watgbot/.data/audit-log.ndjson
```

更新代码：

```bash
cd /opt/watgbot
git pull
npm ci --omit=dev
sudo systemctl restart watg-console
```

## 现阶段仍然存在的已知边界

- 当前仍然是单全局 `currentTicket` 模型，更适合轮班制，不适合多人同时开单
- `下游反馈 / 源头反馈` 仍有一部分是按文本规则推断，不是完整工单系统
- 如果未来要扩成真正多人协作版，下一步优先级应是：
  1. 工单认领锁
  2. 更细粒度角色权限
  3. 审计查询界面
  4. 数据库持久层
