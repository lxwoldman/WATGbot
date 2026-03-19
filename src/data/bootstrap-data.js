export const bootstrapData = {
  currentTicket: {
    id: "T-001",
    status: "active",
    sourceChannelId: "wa-source-alpha",
    league: "韩国K甲组联赛",
    teams: "江原 v 安阳",
    marketText: "小 2 / 2.5 @ 0.90",
    rawOdds: 0.9,
    rebate: 0.03,
    deliveryTarget: 15000,
    internalTarget: 0,
    sourceMessage: {
      arrivedAt: "12:05",
      text: "韩国K甲组联赛\n江原 v 安阳\n小 2 / 2.5 @ 0.90"
    }
  },
  consoleSettings: {
    exchangeRate: 7,
    specialTarget: 20000,
    followAmount: 5000,
    manualAmericas: false,
    customCommands: [
      { id: "wait", label: "等等", text: "等等" },
      { id: "resume", label: "恢复", text: "恢复" },
      { id: "cancel", label: "取消", text: "取消" },
      { id: "urge", label: "催单", text: "好了吗" }
    ]
  },
  sourceChannels: [
    {
      id: "wa-source-alpha",
      type: "whatsapp",
      label: "WA: 国外机构 Alpha",
      remoteId: "",
      online: true
    },
    {
      id: "tg-source-beta",
      type: "telegram",
      label: "TG: 备用源头 Beta",
      remoteId: "",
      online: false
    }
  ],
  resources: [
    {
      id: "resource-1",
      name: "资源 1号",
      bindingLabel: "TG:GrpA",
      platform: "telegram",
      remoteId: "",
      sendEnabled: true,
      canAmericas: true,
      currency: "U",
      amount: 5000,
      slipCount: 3,
      allocationType: "fixed",
      note: ""
    },
    {
      id: "resource-2",
      name: "资源 2号",
      bindingLabel: "WA:ContactB",
      platform: "whatsapp",
      remoteId: "",
      sendEnabled: false,
      canAmericas: false,
      currency: "U",
      amount: 0,
      slipCount: 1,
      allocationType: "fixed",
      note: "当前不做"
    },
    {
      id: "resource-3",
      name: "资源 3号",
      bindingLabel: "TG:GrpC",
      platform: "telegram",
      remoteId: "",
      sendEnabled: true,
      canAmericas: true,
      currency: "U",
      amount: 4000,
      slipCount: 5,
      allocationType: "fixed",
      note: ""
    },
    {
      id: "resource-4",
      name: "大炮U",
      bindingLabel: "TG:GrpD",
      platform: "telegram",
      remoteId: "",
      sendEnabled: true,
      canAmericas: true,
      currency: "U",
      amount: 3000,
      slipCount: 2,
      allocationType: "floating",
      note: "浮动补位"
    }
  ]
};
