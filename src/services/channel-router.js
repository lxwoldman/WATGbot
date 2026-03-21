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

  canSendResourceForTicket(resource, ticket) {
    if (!resource) {
      return false;
    }
    if (resource.enabled === false || !resource.sendEnabled || resource.liveDispatch) {
      return false;
    }
    if (ticket?.isAmericasOrder === true && resource.canAmericas !== true) {
      return false;
    }
    return true;
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

  async sendToResource(resourceId, text, options = {}) {
    const resource = this.store.state.resources.find((item) => item.id === resourceId);
    if (!resource) throw new Error("Resource not found.");
    if (resource.enabled === false) {
      throw new Error("Resource is disabled.");
    }
    if (options.ticket?.isAmericasOrder === true && resource.canAmericas !== true) {
      throw new Error("Resource does not accept Americas orders.");
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

  async broadcastToEnabledResources(text, filterFn = () => true, ticket = null) {
    const resources = this.store.state.resources.filter(
      (resource) => this.canSendResourceForTicket(resource, ticket) && filterFn(resource)
    );
    const results = [];

    for (const resource of resources) {
      try {
        const sendResult = await this.sendToResource(resource.id, text, { ticket });
        results.push({
          resourceId: resource.id,
          resourceName: resource.name,
          platform: resource.platform,
          remoteId: resource.remoteId,
          status: "sent",
          result: sendResult
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          resourceId: resource.id,
          resourceName: resource.name,
          platform: resource.platform,
          remoteId: resource.remoteId,
          status: "failed",
          error: message
        });
        logger.warn("Broadcast send failed for resource", {
          resourceId: resource.id,
          resourceName: resource.name,
          error: message
        });
      }
    }

    const summary = {
      total: results.length,
      sent: results.filter((item) => item.status === "sent").length,
      failed: results.filter((item) => item.status === "failed").length,
      items: results
    };

    this.store.appendLog(`批量发送完成: 成功 ${summary.sent} / 失败 ${summary.failed} / 总计 ${summary.total}`);
    return summary;
  }
}
