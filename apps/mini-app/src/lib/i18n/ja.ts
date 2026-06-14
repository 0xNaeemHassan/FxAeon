import type { Messages } from './config';

/** 日本語 */
const ja: Messages = {
  'nav.home': 'ホーム',
  'nav.trade': '取引',
  'nav.deposit': '入金',
  'nav.settings': '設定',

  'common.openBot': '@{bot} を開く',
  'common.openInTelegram': 'Telegram で開く',
  'common.copyAddress': 'アドレスをコピー',
  'common.copied': 'コピーしました！',
  'common.save': '変更を保存',
  'common.saved': '保存しました',
  'common.back': '戻る',
  'common.retry': '再試行',
  'common.loading': 'f(x) Protocol 取引を読み込み中…',
  'common.unknownError': '不明なエラー',

  'splash.tagline':
    'Telegram のために作られた、f(x) Protocol 上のノンカストディアルなレバレッジ取引。このアプリは FxAeon ボット内で動作します。',

  'loginGate.tgTitle': 'FxAeon は Telegram 内で動作します',
  'loginGate.tgBody': 'ボットを開いて /start を送信し、ウォレットを設定してください。',
  'loginGate.notConfTitle': 'ウォレットサービスが未設定です',
  'loginGate.notConfBody':
    'このビルドには Privy app id がないため、ウォレットの設定を実行できません。運営者の方へ：NEXT_PUBLIC_PRIVY_APP_ID（ボット取引には NEXT_PUBLIC_PRIVY_SIGNER_ID も）を設定して再デプロイしてください。',

  'intro.titleLead': 'メッセージみたいに f(x) を',
  'intro.titleAccent': '取引',
  'intro.subtitle': '自分のウォレットを作成またはインポート — 自己管理、メール不要、妥協なし。',
  'intro.prop1Title': 'あなたのウォレット、あなたの鍵',
  'intro.prop1Body':
    '新しいウォレットを作成するか、既存のものをインポート。鍵はセキュアエンクレーブに保管され、あなただけがエクスポートでき、私たちには見えません。',
  'intro.prop2Title': 'チャットから取引',
  'intro.prop2Body':
    'メッセージひとつで wstETH と WBTC のレバレッジポジションを開設。ワンタップで確定。',
  'intro.prop3Title': '主導権はあなたに',
  'intro.prop3Body':
    'ボット取引はあなたが付与する権限であり、いつでも取り消せます。許可なく署名されることはありません。',
  'intro.referralPre': '🎁 リファラル',
  'intro.referralPost': 'が適用されます',
  'intro.ctaSetup': 'ウォレットを設定',
  'intro.ctaConnecting': '接続中…',
  'intro.ctaMore': 'その他のログイン方法（Google、ウォレット…）',
  'intro.footer': 'デフォルトは Telegram ログイン · 鍵はハードウェアエンクレーブで保護 · いつでもエクスポート可能',

  'portfolio.title': 'ポートフォリオ',
  'portfolio.openInTgTitle': 'Telegram で FxAeon を開く',
  'portfolio.openInTgBody': 'ポートフォリオは Telegram アプリ内にあります。',
  'portfolio.degradedTitle': 'この画面ではライブデータを利用できません',
  'portfolio.degradedNoInit':
    'この起動方法では Telegram の認証情報が渡されません。チャットで /portfolio を使うか、ボットのボタンからアプリを開いてください。',
  'portfolio.degradedNoBackend':
    'このビルドはまだ取引バックエンドに接続されていません。ライブデータはチャットで /portfolio を使ってください。',
  'portfolio.loadFailTitle': 'アカウントを読み込めませんでした',
  'portfolio.walletLabel': 'あなたのウォレット',
  'portfolio.selfCustodyBadge': '自己管理',
  'portfolio.referralCode': 'リファラルコード',
  'portfolio.balances': '残高',
  'portfolio.balancesUnavailable':
    'オンチェーン残高は一時的に利用できません（RPC）。引っ張って更新するか、しばらくしてから再試行してください。',
  'portfolio.fundTitle': '取引を始めるにはウォレットに入金してください。',
  'portfolio.fundBody': 'ETH、wstETH、または WBTC をあなたのアドレスに送り、最初のポジションを開設しましょう。',
  'portfolio.showDeposit': '入金アドレスを表示',
  'portfolio.positions': 'ポジション',
  'portfolio.positionsIncomplete':
    '一部のオンチェーン読み取りに失敗しました — 表示中のポジションは不完全な可能性があります。更新して再試行してください。',
  'portfolio.noPositionsTitle': 'オープンポジションはありません',
  'portfolio.noPositionsBody': 'wstETH または WBTC のレバレッジポジションを開設 — 約30秒で完了します。',
  'portfolio.setupTrade': '取引を設定',
  'portfolio.markets': 'マーケット',
  'portfolio.pricesStale': '価格が数分古い可能性があります（上流の不調）。',
  'portfolio.quickActions': 'クイック操作',
  'portfolio.qaTradeHint': 'レバレッジ最大 10x',
  'portfolio.qaDepositHint': 'ETH · wstETH · WBTC',
  'portfolio.qaSecurity': 'ウォレットの保護方法',
  'portfolio.qaSecurityHint': '自己管理、あなたの鍵',
  'portfolio.colCollateral': '担保',
  'portfolio.colPnl': '損益',
  'portfolio.colHealth': '健全性',
  'portfolio.long': 'ロング',
  'portfolio.short': 'ショート',

  'trade.title': '取引',
  'trade.subtitle': 'f(x) Protocol 上のレバレッジポジション',
  'trade.upTo': '最大 {n}x',
  'trade.long': 'ロング',
  'trade.short': 'ショート',
  'trade.leverage': 'レバレッジ',
  'trade.maxSuffix': '最大 {n}x（{side}）',
  'trade.collateral': '担保（{market}）',
  'trade.totalExposure': '総エクスポージャー ≈',
  'trade.reviewConfirm': 'チャットで確認して確定',
  'trade.confirmNote': 'ボットが署名済みプレビューを表示します — チャットで確認するまで何も実行されません。',
  'trade.reviewInChat': 'チャットで {lev}x {side} を確認',

  'settings.title': '設定',
  'settings.subtitle': 'ボットアカウントと同期済み',
  'settings.openInTgTitle': 'Telegram で FxAeon を開く',
  'settings.openInTgBody': '設定はボットアカウントと同期されます。',
  'settings.cantSyncTitle': 'この画面からは設定を同期できません',
  'settings.cantSyncNoInit':
    'この起動方法では Telegram の認証情報が渡されません。チャットで /settings を使ってください。',
  'settings.cantSyncNoBackend':
    'このビルドはまだ取引バックエンドに接続されていません。チャットで /settings を使ってください。',
  'settings.language': '言語',
  'settings.maxSlippage': '最大スリッページ',
  'settings.mevProtection': 'MEV 保護',
  'settings.privateTx': 'プライベート取引',
  'settings.privateTxSub': 'プライベートリレー経由で送信',

  'deposit.title': '入金',
  'deposit.subtitle': 'ウォレットに入金',
  'deposit.address': 'アドレス',
  'deposit.mainnetOnlyBold': 'Ethereum メインネットのみ。',
  'deposit.mainnetOnlyBody': '上記のトークンのみを送ってください — それ以外は永久に失われる可能性があります。',
  'deposit.unavailableTitle': 'アドレスを利用できません',
  'deposit.noAddress':
    'ウォレットアドレスが渡されていません。ボットのチャットで /deposit を使うか、ボットのボタンからこの画面を開いてください。',
  'deposit.noWallet': 'まだウォレットがありません — ボットに /start を送って作成してください。',

  'policy.title': 'ウォレットのセキュリティ',
  'policy.subtitle': '自己管理、ハードウェアで担保',
  'policy.intro':
    'ウォレットの鍵は信頼された実行環境（TEE）に保管されます。FxAeon はカストディもポリシーロックも持たず、ボットが何をできるかはあなたが取り消し可能な権限で決めます。',
  'policy.rule1Title': '鍵はあなたのもの、それだけ',
  'policy.rule1Body':
    'ウォレットはあなた自身が作成またはインポートします。鍵はハードウェアエンクレーブに保管され、いつでもあなたがエクスポートできます — FxAeon が見ることはありません。',
  'policy.rule2Title': 'ボット取引は付与であり、初期設定ではありません',
  'policy.rule2Body':
    'ボットはあなたの session-signer 権限が有効な間だけ署名できます。設定 → ウォレットで取り消すと、チャットからの実行は即座に停止します。',
  'policy.rule3Title': 'シミュレーションを経た実行',
  'policy.rule3Body':
    'チャットで確認された操作はすべてまずシミュレーションされます。失敗する場合は何もブロードキャストされません — 常にフェイルクローズです。',
  'policy.rule4Title': '明示的な確認のみ',
  'policy.rule4Body':
    'あなたが「確認」をタップするまで、トランザクションは作成も送信もされません。プレビューは約10分で失効します。',
  'policy.footer':
    'すべては 設定 → ウォレット で管理：鍵のエクスポート、ボット取引の有効化や取り消し。最新の状態はボットで /security を確認してください。',
};

export default ja;
