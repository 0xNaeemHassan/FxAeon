# 日本語

## /start

start-welcome-new =
    🚀 fxBotへようこそ
    
    f(x) Protocol向けの最先端インターフェース — レバレッジポジション、指値注文、利回り自動化をすべてTelegramから。
    
    🔐 セルフカストディ — ウォレットを自分で作成またはインポート。鍵はあなただけのもの
    ⚡ シミュレーション必須 — シミュレーションを通過しない限り何も送信されません
    🤖 誠実な設計 — 偽の数字は一切ありません
start-referral-detected = 🎁 紹介コードを検出しました: { $code }
start-tap-button = 👇 下のボタンをタップしてウォレットを作成またはインポートしてください。
start-create-wallet = 🔐 ウォレットを設定
start-welcome-back =
    👋 fxBotへおかえりなさい！
    
    ウォレット: { $wallet }
start-positions =
    📊 アクティブなポジションが{ $count }件あります。
start-quick-actions = クイック操作: /trade /portfolio /settings
start-no-positions =
    アクティブなポジションはまだありません。
    
    はじめる: /trade /portfolio /help
start-error =
    ❌ エラーが発生しました
    
    しばらくしてからもう一度お試しください。問題が続く場合はサポートにお問い合わせください。

## /help

help-body =
    📚 fxBot ヘルプ — コマンドガイド
    
    下のコマンドをタップするか、直接入力してください。
    
    ⚡ トレード
      /trade — レバレッジポジションを開く (1.1x–7x)
      /limit — 指値/ストップ注文
      /orders — アクティブな注文を表示
      /mint — fxUSDを借りる（レバレッジなし）
      /redeem — fxUSDを担保に償還
      /repay — fxUSDの債務を返済
    
    💰 利回りとガバナンス
      /save — fxSAVEへの入出金
      /lock — FXNをロック → veFXN
      /vote — ゲージ投票
      /claim — 報酬を請求
    
    📊 ポートフォリオ
      /portfolio — ポジション・残高・健全性を表示
      /price — ライブ市場概況（価格・時価総額・24h/7d）
      /alert — ワンショット価格アラート（例: /alert btc > 65000）
      /alerts — 価格アラートの管理
      /deposit — ウォレットアドレス + QRを表示
      /withdraw — 外部アドレスへ送金
      /bridge — fxUSDをブリッジ (ETH ↔ Base)
    
    🤖 自動化
      /auto — ストップロス／テイクプロフィット (/auto sl wstETH long 2500)
      /refer — 紹介リンク + 報酬
    
    ⚙️ 設定
      /settings — 言語、スリッページ、MEV保護
      /security — ポリシー、監査、データのエクスポート
      /help — このメニュー
    
    主な特徴:
    • ノンカストディアル — 鍵はPrivyのTEE内
    • オンランプなし — 自分のウォレットに入金
    • MEV保護の切り替え（Flashbots、無料）
    • 8言語対応: en, zh-CN, ko, ja, ru, es, tr, pt
    
    お困りですか？ /start で再接続するか、サポートにお問い合わせください。
help-error = ❌ ヘルプメニューを読み込めませんでした。/start で再接続してください。

## /settings

settings-overview =
    ⚙️ 設定
    
    言語: { $lang }
    スリッページ: { $slippage }%
    MEV保護: { $mev }
    
    変更方法:
    /settings lang en
    /settings slippage 1.0
    /settings mev on|off
settings-mev-on = ✅ Flashbots
settings-mev-off = ❌ オフ
settings-lang-set = 言語を{ $value }に設定しました
settings-slippage-set = スリッページを{ $value }%に設定しました
settings-slippage-invalid = スリッページは0.01%から{ $max }%の間で指定してください
settings-mev-enabled = MEV保護を有効にしました（Flashbots）
settings-mev-disabled = MEV保護を無効にしました
settings-unknown = 不明な設定です。/settings でオプションを確認してください。

## /trade

trade-usage =
    ⚡ レバレッジポジションを開く
    
    下からマーケットを選ぶか、コマンドを直接入力してください。
    
    使い方:
    /trade <マーケット> <long|short> <レバレッジ> <数量>
    
    例:
    /trade wstETH long 3x 1ETH
    
    レバレッジ上限:
    • ロング: { $minLev }x – { $maxLong }x
    • ショート: { $minLev }x – { $maxShort }x

## /portfolio

portfolio-empty =
    { $partial ->
        [yes] 読み取れたマーケットにはアクティブなポジションがありません。
       *[no] アクティブなポジションはありません。
    }
    
    💡 はじめる:
    • /trade — レバレッジポジションを開く
    • /mint — fxUSDを借りる（レバレッジなし）
    • /save — fxSAVEに預けて利回りを得る

## Shared errors

errors-generic = ❌ エラーが発生しました。もう一度お試しください。
