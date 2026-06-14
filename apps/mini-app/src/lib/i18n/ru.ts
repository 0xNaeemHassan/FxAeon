import type { Messages } from './config';

/** Русский */
const ru: Messages = {
  'nav.home': 'Главная',
  'nav.trade': 'Торговля',
  'nav.deposit': 'Пополнить',
  'nav.settings': 'Настройки',

  'common.openBot': 'Открыть @{bot}',
  'common.openInTelegram': 'Открыть в Telegram',
  'common.copyAddress': 'Скопировать адрес',
  'common.copied': 'Скопировано!',
  'common.save': 'Сохранить',
  'common.saved': 'Сохранено',
  'common.back': 'Назад',
  'common.retry': 'Повторить',
  'common.loading': 'Загрузка торговли f(x) Protocol…',
  'common.unknownError': 'Неизвестная ошибка',

  'splash.tagline':
    'Некастодиальная торговля с плечом на f(x) Protocol, созданная для Telegram. Это приложение работает внутри бота FxAeon.',

  'loginGate.tgTitle': 'FxAeon работает внутри Telegram',
  'loginGate.tgBody': 'Откройте бота и отправьте /start, чтобы настроить кошелёк.',
  'loginGate.notConfTitle': 'Сервис кошелька не настроен',
  'loginGate.notConfBody':
    'В этой сборке отсутствует Privy app id, поэтому настройка кошелька невозможна. Если вы оператор: задайте NEXT_PUBLIC_PRIVY_APP_ID (и NEXT_PUBLIC_PRIVY_SIGNER_ID для торговли ботом) и переразверните.',

  'intro.titleLead': 'Торгуйте на f(x), как будто это',
  'intro.titleAccent': 'сообщение',
  'intro.subtitle': 'Создайте или импортируйте собственный кошелёк — самостоятельное хранение, без почты, без компромиссов.',
  'intro.prop1Title': 'Ваш кошелёк, ваши ключи',
  'intro.prop1Body':
    'Создайте новый кошелёк или импортируйте свой. Ключи хранятся в защищённом анклаве — вы можете их экспортировать, мы их не видим.',
  'intro.prop2Title': 'Торговля из чата',
  'intro.prop2Body':
    'Открывайте позиции с плечом по wstETH и WBTC одним сообщением. Подтверждайте одним касанием.',
  'intro.prop3Title': 'Контроль остаётся за вами',
  'intro.prop3Body':
    'Торговля ботом — это разрешение, которое выдаёте ВЫ и можете отозвать в любой момент. Без него ничего не подписывается.',
  'intro.referralPre': '🎁 Реферальный код',
  'intro.referralPost': 'будет применён',
  'intro.ctaSetup': 'Настроить кошелёк',
  'intro.ctaConnecting': 'Подключение…',
  'intro.ctaMore': 'Другие способы входа (Google, кошелёк…)',
  'intro.footer': 'Вход через Telegram по умолчанию · Ключи защищены аппаратными анклавами · Экспорт в любой момент',

  'portfolio.title': 'Портфель',
  'portfolio.openInTgTitle': 'Откройте FxAeon в Telegram',
  'portfolio.openInTgBody': 'Ваш портфель находится в приложении Telegram.',
  'portfolio.degradedTitle': 'На этом экране нет данных в реальном времени',
  'portfolio.degradedNoInit':
    'Этот тип запуска не передаёт учётные данные Telegram. Используйте /portfolio в чате или откройте приложение из кнопки бота.',
  'portfolio.degradedNoBackend':
    'Эта сборка ещё не подключена к торговому бэкенду. Используйте /portfolio в чате для данных в реальном времени.',
  'portfolio.loadFailTitle': 'Не удалось загрузить ваш аккаунт',
  'portfolio.walletLabel': 'Ваш кошелёк',
  'portfolio.selfCustodyBadge': 'самохранение',
  'portfolio.referralCode': 'Реферальный код',
  'portfolio.balances': 'Балансы',
  'portfolio.balancesUnavailable':
    'Ончейн-балансы временно недоступны (RPC). Потяните, чтобы обновить, или попробуйте чуть позже.',
  'portfolio.fundTitle': 'Пополните кошелёк, чтобы начать торговать.',
  'portfolio.fundBody': 'Отправьте ETH, wstETH или WBTC на свой адрес — затем откройте первую позицию.',
  'portfolio.showDeposit': 'Показать адрес для пополнения',
  'portfolio.positions': 'Позиции',
  'portfolio.positionsIncomplete':
    'Часть ончейн-данных не загрузилась — показанные позиции могут быть неполными. Обновите, чтобы повторить.',
  'portfolio.noPositionsTitle': 'Нет открытых позиций',
  'portfolio.noPositionsBody': 'Откройте позицию с плечом по wstETH или WBTC — это занимает около 30 секунд.',
  'portfolio.setupTrade': 'Настроить сделку',
  'portfolio.markets': 'Рынки',
  'portfolio.pricesStale': 'Цены могут отставать на несколько минут (сбой источника).',
  'portfolio.quickActions': 'Быстрые действия',
  'portfolio.qaTradeHint': 'Плечо до 10x',
  'portfolio.qaDepositHint': 'ETH · wstETH · WBTC',
  'portfolio.qaSecurity': 'Как защищён ваш кошелёк',
  'portfolio.qaSecurityHint': 'Самохранение, ваши ключи',
  'portfolio.colCollateral': 'Залог',
  'portfolio.colPnl': 'PnL',
  'portfolio.colHealth': 'Здоровье',
  'portfolio.long': 'лонг',
  'portfolio.short': 'шорт',
  'portfolio.totalValue': 'Общая стоимость',
  'portfolio.valueUnavailable': 'Оценка в реальном времени недоступна',
  'portfolio.pnlUnrealized': 'нереализ. PnL',
  'portfolio.tabPositions': 'Позиции',
  'portfolio.tabFxusd': 'fxUSD',
  'portfolio.fxusdEmptyTitle': 'Нет позиций fxUSD',
  'portfolio.fxusdEmptyBody': 'Отслеживание пула стабильности fxUSD скоро появится. Ваши позиции с плечом показаны в разделе «Позиции».',
  'portfolio.size': 'размер',
  'portfolio.newPosition': 'Новая позиция',

  'trade.title': 'Торговля',
  'trade.subtitle': 'Позиции с плечом на f(x) Protocol',
  'trade.upTo': 'до {n}x',
  'trade.long': 'лонг',
  'trade.short': 'шорт',
  'trade.leverage': 'Плечо',
  'trade.maxSuffix': 'макс. {n}x ({side})',
  'trade.collateral': 'Залог ({market})',
  'trade.totalExposure': 'Общая экспозиция ≈',
  'trade.reviewConfirm': 'Проверить и подтвердить в чате',
  'trade.confirmNote': 'Бот показывает подписанный предпросмотр — ничего не исполняется, пока вы не подтвердите там.',
  'trade.reviewInChat': 'Проверить {lev}x {side} в чате',

  'settings.title': 'Настройки',
  'settings.subtitle': 'Синхронизировано с аккаунтом бота',
  'settings.openInTgTitle': 'Откройте FxAeon в Telegram',
  'settings.openInTgBody': 'Настройки синхронизируются с вашим аккаунтом бота.',
  'settings.cantSyncTitle': 'С этого экрана настройки не синхронизируются',
  'settings.cantSyncNoInit':
    'Этот тип запуска не передаёт учётные данные Telegram. Используйте /settings в чате.',
  'settings.cantSyncNoBackend':
    'Эта сборка ещё не подключена к торговому бэкенду. Используйте /settings в чате.',
  'settings.language': 'Язык',
  'settings.maxSlippage': 'Макс. проскальзывание',
  'settings.mevProtection': 'Защита от MEV',
  'settings.privateTx': 'Приватные транзакции',
  'settings.privateTxSub': 'Через приватный релей',

  'deposit.title': 'Пополнить',
  'deposit.subtitle': 'Пополните кошелёк',
  'deposit.address': 'Адрес',
  'deposit.mainnetOnlyBold': 'Только Ethereum mainnet.',
  'deposit.mainnetOnlyBody': 'Отправляйте только токены выше — всё остальное может быть утрачено навсегда.',
  'deposit.unavailableTitle': 'Адрес недоступен',
  'deposit.noAddress':
    'Адрес кошелька не передан. Используйте /deposit в чате с ботом или откройте этот экран из кнопки бота.',
  'deposit.noWallet': 'Кошелька ещё нет — отправьте /start боту, чтобы создать его.',

  'policy.title': 'Безопасность кошелька',
  'policy.subtitle': 'Самохранение, гарантированное аппаратно',
  'policy.intro':
    'Ключи вашего кошелька хранятся в доверенной среде исполнения (TEE). FxAeon не имеет ни кастоди, ни политики-блокировки — что МОЖЕТ делать бот, решаете вы через отзываемое разрешение.',
  'policy.rule1Title': 'Ваши ключи, и точка',
  'policy.rule1Body':
    'Вы сами создаёте или импортируете кошелёк. Ключ хранится в аппаратном анклаве, вы можете экспортировать его в любой момент — FxAeon его никогда не видит.',
  'policy.rule2Title': 'Торговля ботом — это разрешение, а не настройка по умолчанию',
  'policy.rule2Body':
    'Бот может подписывать только пока активно ваше разрешение session-signer. Отзовите его в Настройки → Кошелёк, и исполнение из чата мгновенно остановится.',
  'policy.rule3Title': 'Исполнение через симуляцию',
  'policy.rule3Body':
    'Каждое подтверждённое в чате действие сначала симулируется. Если оно бы не прошло, ничего не отправляется — всегда безопасный отказ.',
  'policy.rule4Title': 'Только явные подтверждения',
  'policy.rule4Body':
    'Ни одна транзакция не формируется и не отправляется, пока вы не нажмёте «Подтвердить». Предпросмотры истекают примерно через 10 минут.',
  'policy.footer':
    'Управляйте всем в Настройки → Кошелёк: экспортируйте ключ, включайте или отзывайте торговлю ботом. Проверьте /security в боте для актуального статуса.',
  // -- login sign-in card (PrivyFlow intro) --
  'loginCard.signIn': 'Вход в FxAeon',
  'loginCard.subtitle': 'Некастодиальный кошелёк на базе Privy',
  'loginCard.telegram': 'Продолжить через Telegram',
  'loginCard.email': 'Продолжить по эл. почте',
  'loginCard.wallet': 'Подключить существующий кошелёк',
  'loginCard.terms': 'Продолжая, вы принимаете наши Условия и Политику конфиденциальности',
  'loginCard.poweredBy': 'Работает на',
};

export default ru;
