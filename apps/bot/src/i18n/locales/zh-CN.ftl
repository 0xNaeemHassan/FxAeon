# 简体中文

## /start

start-welcome-new =
    🚀 欢迎使用 fxBot
    
    f(x) Protocol 最先进的交易界面 — 杠杆头寸、限价订单、收益自动化，全部在 Telegram 中完成。
    
    🔐 自托管 — 创建或导入您自己的钱包；私钥只属于您
    ⚡ 模拟验证 — 模拟未通过的交易绝不会广播
    🤖 诚实设计 — 绝无虚假数据
start-referral-detected = 🎁 检测到推荐码: { $code }
start-tap-button = 👇 点击下方按钮创建或导入您的钱包。
start-create-wallet = 🔐 设置钱包
start-welcome-back =
    👋 欢迎回到 fxBot！
    
    钱包: { $wallet }
start-positions =
    📊 您有 { $count } 个活跃头寸。
start-quick-actions = 快捷操作: /trade /portfolio /settings
start-no-positions =
    暂无活跃头寸。
    
    开始使用: /trade /portfolio /help
start-error =
    ❌ 哎呀，出错了
    
    请稍后重试。如果问题持续存在，请联系客服。

## /help

help-body =
    📚 fxBot 帮助 — 命令指南
    
    点击下方任意命令即可使用，也可以直接输入。
    
    ⚡ 交易
      /trade — 开杠杆头寸 (1.1x–7x)
      /limit — 下限价/止损单
      /orders — 查看活跃订单
      /mint — 借入 fxUSD（无杠杆）
      /redeem — 用 fxUSD 赎回抵押品
      /repay — 偿还 fxUSD 债务
    
    💰 收益与治理
      /save — fxSAVE 存取
      /lock — 锁定 FXN → veFXN
      /vote — Gauge 投票
      /claim — 领取奖励
    
    📊 投资组合
      /portfolio — 查看头寸、余额、健康度
      /price — 实时市场概览（价格、市值、24h/7d）
      /alert — 一次性价格提醒（如 /alert btc > 65000）
      /alerts — 管理价格提醒
      /deposit — 显示钱包地址 + 二维码
      /withdraw — 转账到外部地址
      /bridge — 跨链 fxUSD (ETH ↔ Base)
    
    🤖 自动化
      /auto — 创建/管理自动化规则
      /refer — 您的推荐链接 + 收益
    
    ⚙️ 设置
      /settings — 语言、滑点、MEV 保护
      /security — 策略、审计、数据导出
      /help — 本菜单
    
    核心特性:
    • 非托管 — 密钥保存在 Privy TEE 中
    • 无入金通道 — 自行为钱包充值
    • 可切换 MEV 保护（Flashbots，免费）
    • 6 种语言: en, zh-CN, ko, ja, ru, es
    
    需要帮助？使用 /start 重新连接或联系客服。
help-error = ❌ 无法加载帮助菜单。请尝试 /start 重新连接。

## /settings

settings-overview =
    ⚙️ 设置
    
    语言: { $lang }
    滑点: { $slippage }%
    MEV 保护: { $mev }
    
    修改方式:
    /settings lang en
    /settings slippage 1.0
    /settings mev on|off
settings-mev-on = ✅ Flashbots
settings-mev-off = ❌ 关闭
settings-lang-set = 语言已设置为 { $value }
settings-slippage-set = 滑点已设置为 { $value }%
settings-slippage-invalid = 滑点必须在 0.01% 到 { $max }% 之间
settings-mev-enabled = MEV 保护已开启 (Flashbots)
settings-mev-disabled = MEV 保护已关闭
settings-unknown = 未知设置。使用 /settings 查看选项。

## /trade

trade-usage =
    ⚡ 开杠杆头寸
    
    在下方选择市场，或直接输入完整命令。
    
    用法:
    /trade <市场> <long|short> <杠杆> <数量>
    
    示例:
    /trade wstETH long 3x 1ETH
    
    杠杆限制:
    • 做多: { $minLev }x – { $maxLong }x
    • 做空: { $minLev }x – { $maxShort }x

## /portfolio

portfolio-empty =
    { $partial ->
        [yes] 在可读取的市场中没有活跃头寸。
       *[no] 没有活跃头寸。
    }
    
    💡 开始使用:
    • /trade — 开杠杆头寸
    • /mint — 借入 fxUSD（无杠杆）
    • /save — 存入 fxSAVE 赚取收益

## Shared errors

errors-generic = ❌ 发生错误。请重试。
