import { logger } from "../lib/logger.js";

export class ChannelRouter {
  constructor({ store, whatsappAdapter, telegramAdapter }) {
    this.store = store;
    this.whatsappAdapter = whatsappAdapter;
    this.telegramAdapter = telegramAdapter;
  }

  async sendToChannel(channel, text) {
    if (channel.type === "whatsapp") {
      return this.whatsappAdapter.sendText({
        to: channel.remoteId,
        previewLabel: channel.label,
        text
      });
    }
    if (channel.type === "telegram") {
      return this.telegramAdapter.sendText({
        chatId: channel.remoteId,
        previewLabel: channel.label,
        text
      });
    }
    throw new Error(`Unsupported channel type: ${channel.type}`);
  }

  ensureDelivered(result, targetLabel) {
    if (!result?.dryRun) {
      return result;
    }

    const reasonMap = {
      missing_chat_id: "缺少聊天对象 ID",
      client_not_ready: "WhatsApp 当前未就绪或已掉线",
      missing_entity: "缺少 Telegram 会话目标",
      client_not_authorized: "Telegram 当前未授权",
      send_queue_full: "发送队列已满"
    };
    const detail = reasonMap[result.reason] || result.reason || "通道未实际发送";
    throw new Error(`${targetLabel} 未发送成功: ${detail}`);
  }

  async replyToSource(sourceChannelId, text) {
    const channel = this.store.state.sourceChannels.find((item) => item.id === sourceChannelId);
    if (!channel) {
      throw new Error("Source channel not found.");
    }
    const result = this.ensureDelivered(await this.sendToChannel(channel, text), channel.label || "源头");
    this.store.appendLog(`向源头发送: ${text}`);
    logger.info("Replied to source channel", { sourceChannelId, text });
    return result;
  }

  async sendToResource(resourceId, text) {
    const resource = this.store.state.resources.find((item) => item.id === resourceId);
    if (!resource) throw new Error("Resource not found.");
    if (resource.enabled === false) {
      throw new Error("Resource is disabled.");
    }

    const channel = {
      type: resource.platform,
      remoteId: resource.remoteId,
      label: resource.bindingLabel
    };
    const result = this.ensureDelivered(await this.sendToChannel(channel, text), resource.name || "资源");
    this.store.appendLog(`向资源发送: ${resource.name}`);
    logger.info("Sent to resource", { resourceId, text });
    return result;
  }

  async broadcastToEnabledResources(text, filterFn = () => true) {
    const resources = this.store.state.resources.filter(
      (resource) => resource.enabled !== false && resource.sendEnabled && !resource.liveDispatch && filterFn(resource)
    );
    const results = await Promise.all(resources.map((resource) => this.sendToResource(resource.id, text)));
    this.store.appendLog(`批量发送给 ${resources.length} 个资源`);
    return results;
  }
}
