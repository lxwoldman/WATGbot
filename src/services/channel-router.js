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

  async replyToSource(sourceChannelId, text) {
    const channel = this.store.state.sourceChannels.find((item) => item.id === sourceChannelId);
    if (!channel) {
      throw new Error("Source channel not found.");
    }
    const result = await this.sendToChannel(channel, text);
    this.store.appendLog(`向源头发送: ${text}`);
    logger.info("Replied to source channel", { sourceChannelId, text });
    return result;
  }

  async sendToResource(resourceId, text) {
    const resource = this.store.state.resources.find((item) => item.id === resourceId);
    if (!resource) throw new Error("Resource not found.");

    const channel = {
      type: resource.platform,
      remoteId: resource.remoteId,
      label: resource.bindingLabel
    };
    const result = await this.sendToChannel(channel, text);
    this.store.appendLog(`向资源发送: ${resource.name}`);
    logger.info("Sent to resource", { resourceId, text });
    return result;
  }

  async broadcastToEnabledResources(text, filterFn = () => true) {
    const resources = this.store.state.resources.filter((resource) => resource.sendEnabled && filterFn(resource));
    const results = await Promise.all(resources.map((resource) => this.sendToResource(resource.id, text)));
    this.store.appendLog(`批量发送给 ${resources.length} 个资源`);
    return results;
  }
}
