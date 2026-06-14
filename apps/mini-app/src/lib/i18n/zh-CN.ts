import type { Messages } from './config';

/** 简体中文 */
const zhCN: Messages = {
  'nav.home': '首页',
  'nav.trade': '交易',
  'nav.deposit': '充值',
  'nav.settings': '设置',

  'common.openBot': '打开 @{bot}',
  'common.openInTelegram': '在 Telegram 中打开',
  'common.copyAddress': '复制地址',
  'common.copied': '已复制！',
  'common.save': '保存更改',
  'common.saved': '已保存',
  'common.back': '返回',
  'common.retry': '重试',
  'common.loading': '正在加载 f(x) Protocol 交易…',
  'common.unknownError': '未知错误',

  'splash.tagline':
    '在 f(x) Protocol 上进行非托管杠杆交易，专为 Telegram 打造。本应用在 FxAeon 机器人内运行。',

  'loginGate.tgTitle': 'FxAeon 在 Telegram 中运行',
  'loginGate.tgBody': '打开机器人并发送 /start 来设置你的钱包。',
  'loginGate.notConfTitle': '钱包服务未配置',
  'loginGate.notConfBody':
    '此版本缺少 Privy app id，因此无法进行钱包设置。如果你是运营者：请设置 NEXT_PUBLIC_PRIVY_APP_ID（机器人交易还需 NEXT_PUBLIC_PRIVY_SIGNER_ID）并重新部署。',

  'intro.titleLead': '像发消息一样交易',
  'intro.titleAccent': 'f(x)',
  'intro.subtitle': '创建或导入你自己的钱包 —— 自我托管，无需邮箱，绝不妥协。',
  'intro.prop1Title': '你的钱包，你的私钥',
  'intro.prop1Body':
    '创建新钱包或导入已有钱包。私钥存放在安全飞地中 —— 仅你可导出，我们无法看到。',
  'intro.prop2Title': '在聊天中交易',
  'intro.prop2Body': '用一条消息开立 wstETH 和 WBTC 杠杆仓位。一键确认。',
  'intro.prop3Title': '掌控权始终在你手中',
  'intro.prop3Body':
    '机器人交易是由你授予的权限 —— 随时可撤销。未经授权不会签署任何交易。',
  'intro.referralPre': '🎁 推荐码',
  'intro.referralPost': '将被应用',
  'intro.ctaSetup': '设置我的钱包',
  'intro.ctaConnecting': '连接中…',
  'intro.ctaMore': '更多登录方式（Google、钱包…）',
  'intro.footer': '默认使用 Telegram 登录 · 私钥由硬件飞地保护 · 随时可导出',

  'portfolio.title': '资产组合',
  'portfolio.openInTgTitle': '在 Telegram 中打开 FxAeon',
  'portfolio.openInTgBody': '你的资产组合在 Telegram 应用中。',
  'portfolio.degradedTitle': '此界面无法获取实时数据',
  'portfolio.degradedNoInit':
    '此启动方式不携带 Telegram 凭据。请在聊天中使用 /portfolio，或从机器人按钮打开应用。',
  'portfolio.degradedNoBackend':
    '此版本尚未连接交易后端。请在聊天中使用 /portfolio 查看实时数据。',
  'portfolio.loadFailTitle': '无法加载你的账户',
  'portfolio.walletLabel': '你的钱包',
  'portfolio.selfCustodyBadge': '自我托管',
  'portfolio.referralCode': '推荐码',
  'portfolio.balances': '余额',
  'portfolio.balancesUnavailable':
    '链上余额暂时不可用（RPC）。请下拉刷新或稍后再试。',
  'portfolio.fundTitle': '为钱包充值以开始交易。',
  'portfolio.fundBody': '向你的地址发送 ETH、wstETH 或 WBTC —— 然后开立你的第一个仓位。',
  'portfolio.showDeposit': '显示充值地址',
  'portfolio.positions': '仓位',
  'portfolio.positionsIncomplete':
    '部分链上读取失败 —— 显示的仓位可能不完整。请刷新重试。',
  'portfolio.noPositionsTitle': '暂无持仓',
  'portfolio.noPositionsBody': '开立一个 wstETH 或 WBTC 杠杆仓位 —— 大约只需 30 秒。',
  'portfolio.setupTrade': '设置交易',
  'portfolio.markets': '市场',
  'portfolio.pricesStale': '价格可能有几分钟延迟（上游波动）。',
  'portfolio.quickActions': '快捷操作',
  'portfolio.qaTradeHint': '杠杆最高 10x',
  'portfolio.qaDepositHint': 'ETH · wstETH · WBTC',
  'portfolio.qaSecurity': '你的钱包如何受到保护',
  'portfolio.qaSecurityHint': '自我托管，你的私钥',
  'portfolio.colCollateral': '保证金',
  'portfolio.colPnl': '盈亏',
  'portfolio.colHealth': '健康度',
  'portfolio.long': '做多',
  'portfolio.short': '做空',

  'trade.title': '交易',
  'trade.subtitle': '在 f(x) Protocol 上的杠杆仓位',
  'trade.upTo': '最高 {n}x',
  'trade.long': '做多',
  'trade.short': '做空',
  'trade.leverage': '杠杆',
  'trade.maxSuffix': '最高 {n}x（{side}）',
  'trade.collateral': '保证金（{market}）',
  'trade.totalExposure': '总敞口 ≈',
  'trade.reviewConfirm': '在聊天中查看并确认',
  'trade.confirmNote': '机器人会显示已签名的预览 —— 在你于聊天中确认前不会执行任何交易。',
  'trade.reviewInChat': '在聊天中查看 {lev}x {side}',

  'settings.title': '设置',
  'settings.subtitle': '已与你的机器人账户同步',
  'settings.openInTgTitle': '在 Telegram 中打开 FxAeon',
  'settings.openInTgBody': '设置会与你的机器人账户同步。',
  'settings.cantSyncTitle': '此界面无法同步设置',
  'settings.cantSyncNoInit':
    '此启动方式不携带 Telegram 凭据。请改在聊天中使用 /settings。',
  'settings.cantSyncNoBackend':
    '此版本尚未连接交易后端。请改在聊天中使用 /settings。',
  'settings.language': '语言',
  'settings.maxSlippage': '最大滑点',
  'settings.mevProtection': 'MEV 保护',
  'settings.privateTx': '私密交易',
  'settings.privateTxSub': '通过私有中继转发',

  'deposit.title': '充值',
  'deposit.subtitle': '为你的钱包充值',
  'deposit.address': '地址',
  'deposit.mainnetOnlyBold': '仅限 Ethereum 主网。',
  'deposit.mainnetOnlyBody': '仅发送上述代币 —— 其他代币可能永久丢失。',
  'deposit.unavailableTitle': '地址不可用',
  'deposit.noAddress':
    '未传入钱包地址。请在机器人聊天中使用 /deposit，或从机器人按钮打开此界面。',
  'deposit.noWallet': '尚无钱包 —— 请向机器人发送 /start 来创建。',

  'policy.title': '钱包安全',
  'policy.subtitle': '自我托管，由硬件保障',
  'policy.intro':
    '你的钱包私钥存放在可信执行环境（TEE）中。FxAeon 不持有托管权，也无策略锁 —— 机器人能做什么由你通过可撤销的权限决定。',
  'policy.rule1Title': '你的私钥，绝对属于你',
  'policy.rule1Body':
    '钱包由你自己创建或导入。私钥存放在硬件飞地中，随时可由你导出 —— FxAeon 永远看不到它。',
  'policy.rule2Title': '机器人交易是授权，而非默认',
  'policy.rule2Body':
    '只有在你的会话签名者授权有效期间，机器人才能签名。在设置 → 钱包中撤销，聊天执行将立即停止。',
  'policy.rule3Title': '经模拟校验的执行',
  'policy.rule3Body':
    '每个在聊天中确认的操作都会先进行模拟。如果会失败，则不会广播任何交易 —— 始终安全失败。',
  'policy.rule4Title': '仅限明确确认',
  'policy.rule4Body':
    '在你点击“确认”之前，不会构建或发送任何交易。预览将在约 10 分钟后失效。',
  'policy.footer':
    '在设置 → 钱包中管理一切：导出私钥、启用或撤销机器人交易。在机器人中查看 /security 了解实时状态。',
};

export default zhCN;
