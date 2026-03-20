import fs from "node:fs/promises";
import path from "node:path";
import { bootstrapData } from "../data/bootstrap-data.js";
import {
  buildReceiptText,
  computeAllocated,
  computeFinalOdds,
  computeGap,
  computeTargetTotal,
  parseOddsFromMarket
} from "./calculation-service.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function slugify(value, fallbackPrefix) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `${fallbackPrefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeCustomCommand(command, index = 0) {
  const text = String(command?.text || "").trim();
  const label = String(command?.label || "").trim();

  if (!text) {
    return null;
  }

  return {
    id: String(command?.id || `cmd-${index + 1}`),
    label: label || text.slice(0, 8) || `指令 ${index + 1}`,
    text
  };
}

function normalizeConsoleSettings(settings = {}) {
  const defaultSettings = bootstrapData.consoleSettings || {};
  const customCommands = Array.isArray(settings.customCommands)
    ? settings.customCommands.map((item, index) => normalizeCustomCommand(item, index)).filter(Boolean)
    : [];

  return {
    exchangeRate: Number(settings.exchangeRate ?? defaultSettings.exchangeRate ?? 7) || 7,
    specialTarget: Number(settings.specialTarget ?? defaultSettings.specialTarget ?? 20000) || 0,
    followAmount: Number(settings.followAmount ?? defaultSettings.followAmount ?? 5000) || 0,
    manualAmericas: Boolean(settings.manualAmericas ?? defaultSettings.manualAmericas ?? false),
    safetyLock: Boolean(settings.safetyLock ?? defaultSettings.safetyLock ?? false),
    customCommands: customCommands.length
      ? customCommands
      : (defaultSettings.customCommands || [])
          .map((item, index) => normalizeCustomCommand(item, index))
          .filter(Boolean)
  };
}

function normalizeResource(resource = {}) {
  const liveDispatch = Boolean(resource.liveDispatch);
  return {
    ...resource,
    enabled: resource.enabled !== false,
    sendEnabled: liveDispatch ? false : Boolean(resource.sendEnabled),
    includeInAllocation: Boolean(resource.includeInAllocation ?? resource.sendEnabled),
    liveDispatch,
    canAmericas: Boolean(resource.canAmericas),
    currency: resource.currency === "RMB" ? "RMB" : "U",
    amount: Number(resource.amount ?? 0) || 0,
    slipCount: Number(resource.slipCount ?? 0) || 0,
    allocationType: resource.allocationType === "floating" ? "floating" : "fixed",
    note: String(resource.note || "")
  };
}

function normalizeSourceChannel(channel = {}) {
  return {
    ...channel,
    online: Boolean(channel.online),
    note: String(channel.note || "")
  };
}

export class StoreService {
  constructor(config = {}) {
    this.config = {
      stateFile: path.resolve(config.stateFile || ".data/console-state.json"),
      autosaveDebounceMs: Number(config.autosaveDebounceMs) || 150,
      auditFile: path.resolve(config.auditFile || ".data/audit-log.ndjson")
    };
    this.state = clone(bootstrapData);
    this.logs = [
      { id: crypto.randomUUID(), time: new Date().toISOString(), level: "info", message: "系统初始化完成" }
    ];
    this.persistTimer = null;
    this.persistPromise = null;
    this.auditPromise = null;
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.config.stateFile), { recursive: true });
    await fs.mkdir(path.dirname(this.config.auditFile), { recursive: true });

    try {
      const raw = await fs.readFile(this.config.stateFile, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.state) {
        this.state = clone({
          ...bootstrapData,
          ...parsed.state,
          currentTicket: {
            ...bootstrapData.currentTicket,
            ...(parsed.state.currentTicket || {})
          },
          consoleSettings: normalizeConsoleSettings(parsed.state.consoleSettings),
          sourceChannels: Array.isArray(parsed.state.sourceChannels)
            ? parsed.state.sourceChannels.map((item) => normalizeSourceChannel(item))
            : bootstrapData.sourceChannels.map((item) => normalizeSourceChannel(item)),
          resources: Array.isArray(parsed.state.resources)
            ? parsed.state.resources.map((item) => normalizeResource(item))
            : bootstrapData.resources.map((item) => normalizeResource(item))
        });
      }

      if (Array.isArray(parsed?.logs) && parsed.logs.length) {
        this.logs = parsed.logs.slice(0, 200);
      }

      this.appendLog("已从磁盘恢复控制台状态");
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.appendLog(`状态恢复失败，已回退默认内存态: ${error.message}`, "warn");
      }
    }

    return this.getSnapshot();
  }

  getSnapshot() {
    const resources = this.state.resources;
    const ticket = this.state.currentTicket;
    const consoleSettings = normalizeConsoleSettings(this.state.consoleSettings);
    const rawOdds = ticket.rawOdds || parseOddsFromMarket(ticket.marketText);
    const finalOdds = computeFinalOdds(rawOdds, ticket.rebate);
    const targetTotal = computeTargetTotal(ticket);
    const allocated = computeAllocated(resources, consoleSettings.exchangeRate);
    const gap = computeGap(targetTotal, allocated);

    return {
      currentTicket: {
        ...ticket,
        rawOdds,
        finalOdds,
        targetTotal,
        allocated,
        gap
      },
      consoleSettings: clone(consoleSettings),
      sourceChannels: clone(this.state.sourceChannels),
      resources: clone(resources),
      logs: clone(this.logs)
    };
  }

  appendLog(message, level = "info") {
    this.logs.unshift({
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      level,
      message
    });
    this.logs = this.logs.slice(0, 200);
    this.schedulePersist();
  }

  updateTicket(patch) {
    this.state.currentTicket = {
      ...this.state.currentTicket,
      ...patch
    };
    if (patch.marketText && !patch.rawOdds) {
      this.state.currentTicket.rawOdds = parseOddsFromMarket(patch.marketText);
    }
    this.appendLog("更新当前交易单信息");
    return this.getSnapshot().currentTicket;
  }

  updateConsoleSettings(patch) {
    this.state.consoleSettings = normalizeConsoleSettings({
      ...this.state.consoleSettings,
      ...patch
    });
    this.appendLog("更新共享控制台配置");
    return clone(this.state.consoleSettings);
  }

  updateResource(resourceId, patch) {
    const resource = this.state.resources.find((item) => item.id === resourceId);
    if (!resource) return null;
    Object.assign(resource, normalizeResource({ ...resource, ...patch }));
    this.appendLog(`更新资源配置: ${resource.name}`);
    return clone(resource);
  }

  updateSourceChannel(sourceChannelId, patch) {
    const sourceChannel = this.state.sourceChannels.find((item) => item.id === sourceChannelId);
    if (!sourceChannel) return null;
    Object.assign(sourceChannel, normalizeSourceChannel({ ...sourceChannel, ...patch }));
    this.appendLog(`更新源头通道: ${sourceChannel.label}`);
    return clone(sourceChannel);
  }

  upsertSourceChannelFromChat({ type, remoteId, label, note = "" }) {
    const normalizedRemoteId = String(remoteId || "").trim();
    const existing = this.state.sourceChannels.find(
      (item) => item.type === type && String(item.remoteId || "") === normalizedRemoteId
    );

    if (existing) {
      existing.label = label || existing.label;
      existing.note = note;
      existing.remoteId = normalizedRemoteId;
      this.appendLog(`更新供应商绑定: ${existing.label}`);
      return clone(existing);
    }

    const created = {
      id: `source-${slugify(label || normalizedRemoteId, "source")}`,
      type,
      label: label || normalizedRemoteId,
      remoteId: normalizedRemoteId,
      online: false,
      note
    };

    this.state.sourceChannels.push(created);
    if (!this.state.currentTicket.sourceChannelId) {
      this.state.currentTicket.sourceChannelId = created.id;
    }
    this.appendLog(`新增供应商绑定: ${created.label}`);
    return clone(created);
  }

  removeSourceChannel(sourceChannelId) {
    const index = this.state.sourceChannels.findIndex((item) => item.id === sourceChannelId);
    if (index < 0) return null;
    const [removed] = this.state.sourceChannels.splice(index, 1);

    if (this.state.currentTicket.sourceChannelId === sourceChannelId) {
      this.state.currentTicket.sourceChannelId = this.state.sourceChannels[0]?.id || "";
    }

    this.appendLog(`移除供应商绑定: ${removed.label}`);
    return clone(removed);
  }

  upsertResourceFromChat({ platform, remoteId, name, note = "" }) {
    const normalizedRemoteId = String(remoteId || "").trim();
    const existing = this.state.resources.find(
      (item) => item.platform === platform && String(item.remoteId || "") === normalizedRemoteId
    );

    if (existing) {
      existing.name = name || existing.name;
      existing.bindingLabel = note || existing.bindingLabel || existing.name;
      existing.note = note;
      existing.remoteId = normalizedRemoteId;
      this.appendLog(`更新分销商绑定: ${existing.name}`);
      return clone(existing);
    }

    const created = {
      id: `resource-${slugify(name || normalizedRemoteId, "resource")}`,
      name: name || normalizedRemoteId,
      bindingLabel: note || name || normalizedRemoteId,
      platform,
      remoteId: normalizedRemoteId,
      enabled: true,
      sendEnabled: true,
      includeInAllocation: true,
      liveDispatch: false,
      canAmericas: true,
      currency: "U",
      amount: 0,
      slipCount: 1,
      allocationType: "fixed",
      note
    };

    this.state.resources.push(created);
    this.appendLog(`新增分销商绑定: ${created.name}`);
    return clone(created);
  }

  removeResource(resourceId) {
    const index = this.state.resources.findIndex((item) => item.id === resourceId);
    if (index < 0) return null;
    const [removed] = this.state.resources.splice(index, 1);
    this.appendLog(`移除分销商绑定: ${removed.name}`);
    return clone(removed);
  }

  buildReceipt(resourceId, amountOverride, slipCountOverride) {
    const resource = this.state.resources.find((item) => item.id === resourceId);
    if (!resource) return null;
    const ticket = this.getSnapshot().currentTicket;
    const slipCount = Number(slipCountOverride ?? resource.slipCount) + 1;
    const amount = Number(amountOverride ?? resource.amount);
    return {
      resourceId,
      resourceName: resource.name,
      amount,
      slipCount,
      text: buildReceiptText({
        slipCount,
        league: ticket.league,
        teams: ticket.teams,
        marketText: ticket.marketText,
        finalOdds: ticket.finalOdds,
        amount
      })
    };
  }

  schedulePersist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      void this.persistNow();
    }, this.config.autosaveDebounceMs);
  }

  async persistNow() {
    clearTimeout(this.persistTimer);
    this.persistTimer = null;

    if (this.persistPromise) {
      return await this.persistPromise;
    }

    this.persistPromise = fs.writeFile(
      this.config.stateFile,
      JSON.stringify(
        {
          savedAt: new Date().toISOString(),
          state: this.state,
          logs: this.logs
        },
        null,
        2
      )
    );

    try {
      await this.persistPromise;
    } finally {
      this.persistPromise = null;
    }
  }

  async recordAudit(entry) {
    const payload = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      ...entry
    };

    const line = `${JSON.stringify(payload)}\n`;
    this.auditPromise = (this.auditPromise || Promise.resolve())
      .then(() => fs.appendFile(this.config.auditFile, line))
      .catch((error) => {
        console.error(`[audit] failed to append audit log: ${error.message}`);
      });

    return await this.auditPromise;
  }

  async flushAudit() {
    return await (this.auditPromise || Promise.resolve());
  }
}
