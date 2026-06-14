import type { Messages } from './config';

/** 한국어 */
const ko: Messages = {
  'nav.home': '홈',
  'nav.trade': '거래',
  'nav.deposit': '입금',
  'nav.settings': '설정',

  'common.openBot': '@{bot} 열기',
  'common.openInTelegram': 'Telegram에서 열기',
  'common.copyAddress': '주소 복사',
  'common.copied': '복사됨!',
  'common.save': '변경사항 저장',
  'common.saved': '저장됨',
  'common.back': '뒤로',
  'common.retry': '다시 시도',
  'common.loading': 'f(x) Protocol 거래 불러오는 중…',
  'common.unknownError': '알 수 없는 오류',

  'splash.tagline':
    'Telegram을 위해 만들어진 f(x) Protocol의 비수탁형 레버리지 거래. 이 앱은 FxAeon 봇 안에서 실행됩니다.',

  'loginGate.tgTitle': 'FxAeon은 Telegram 안에서 실행됩니다',
  'loginGate.tgBody': '봇을 열고 /start를 보내 지갑을 설정하세요.',
  'loginGate.notConfTitle': '지갑 서비스가 구성되지 않았습니다',
  'loginGate.notConfBody':
    '이 빌드에는 Privy app id가 없어 지갑 설정을 실행할 수 없습니다. 운영자라면: NEXT_PUBLIC_PRIVY_APP_ID(봇 거래에는 NEXT_PUBLIC_PRIVY_SIGNER_ID도)를 설정하고 다시 배포하세요.',

  'intro.titleLead': '메시지처럼 f(x)를',
  'intro.titleAccent': '거래하세요',
  'intro.subtitle': '자신의 지갑을 만들거나 가져오세요 — 자기수탁, 이메일 없이, 타협 없이.',
  'intro.prop1Title': '당신의 지갑, 당신의 키',
  'intro.prop1Body':
    '새 지갑을 만들거나 기존 지갑을 가져오세요. 키는 보안 엔클레이브에 저장되며 — 오직 당신만 내보낼 수 있고 우리는 볼 수 없습니다.',
  'intro.prop2Title': '채팅에서 거래',
  'intro.prop2Body':
    '메시지 하나로 wstETH와 WBTC 레버리지 포지션을 여세요. 한 번의 탭으로 확정.',
  'intro.prop3Title': '주도권은 당신에게',
  'intro.prop3Body':
    '봇 거래는 당신이 부여하는 권한이며 — 언제든 철회할 수 있습니다. 권한 없이는 아무것도 서명되지 않습니다.',
  'intro.referralPre': '🎁 추천 코드',
  'intro.referralPost': '가 적용됩니다',
  'intro.ctaSetup': '내 지갑 설정',
  'intro.ctaConnecting': '연결 중…',
  'intro.ctaMore': '다른 로그인 방법 (Google, 지갑…)',
  'intro.footer': '기본은 Telegram 로그인 · 키는 하드웨어 엔클레이브로 보호 · 언제든 내보내기 가능',

  'portfolio.title': '포트폴리오',
  'portfolio.openInTgTitle': 'Telegram에서 FxAeon 열기',
  'portfolio.openInTgBody': '포트폴리오는 Telegram 앱 안에 있습니다.',
  'portfolio.degradedTitle': '이 화면에서는 실시간 데이터를 사용할 수 없습니다',
  'portfolio.degradedNoInit':
    '이 실행 방식은 Telegram 자격 증명을 전달하지 않습니다. 채팅에서 /portfolio를 사용하거나 봇 버튼으로 앱을 여세요.',
  'portfolio.degradedNoBackend':
    '이 빌드는 아직 거래 백엔드에 연결되지 않았습니다. 실시간 데이터는 채팅에서 /portfolio를 사용하세요.',
  'portfolio.loadFailTitle': '계정을 불러올 수 없습니다',
  'portfolio.walletLabel': '내 지갑',
  'portfolio.selfCustodyBadge': '자기수탁',
  'portfolio.referralCode': '추천 코드',
  'portfolio.balances': '잔액',
  'portfolio.balancesUnavailable':
    '온체인 잔액을 일시적으로 사용할 수 없습니다(RPC). 당겨서 새로고침하거나 잠시 후 다시 시도하세요.',
  'portfolio.fundTitle': '거래를 시작하려면 지갑에 입금하세요.',
  'portfolio.fundBody': 'ETH, wstETH 또는 WBTC를 주소로 보내고 — 첫 포지션을 여세요.',
  'portfolio.showDeposit': '입금 주소 보기',
  'portfolio.positions': '포지션',
  'portfolio.positionsIncomplete':
    '일부 온체인 읽기에 실패했습니다 — 표시된 포지션이 불완전할 수 있습니다. 새로고침하여 다시 시도하세요.',
  'portfolio.noPositionsTitle': '열린 포지션 없음',
  'portfolio.noPositionsBody': 'wstETH 또는 WBTC 레버리지 포지션을 여세요 — 약 30초면 됩니다.',
  'portfolio.setupTrade': '거래 설정',
  'portfolio.markets': '마켓',
  'portfolio.pricesStale': '가격이 몇 분 지났을 수 있습니다(상류 지연).',
  'portfolio.quickActions': '빠른 작업',
  'portfolio.qaTradeHint': '레버리지 최대 10x',
  'portfolio.qaDepositHint': 'ETH · wstETH · WBTC',
  'portfolio.qaSecurity': '지갑 보호 방식',
  'portfolio.qaSecurityHint': '자기수탁, 당신의 키',
  'portfolio.colCollateral': '담보',
  'portfolio.colPnl': '손익',
  'portfolio.colHealth': '건전성',
  'portfolio.long': '롱',
  'portfolio.short': '숏',

  'trade.title': '거래',
  'trade.subtitle': 'f(x) Protocol의 레버리지 포지션',
  'trade.upTo': '최대 {n}x',
  'trade.long': '롱',
  'trade.short': '숏',
  'trade.leverage': '레버리지',
  'trade.maxSuffix': '최대 {n}x ({side})',
  'trade.collateral': '담보 ({market})',
  'trade.totalExposure': '총 익스포저 ≈',
  'trade.reviewConfirm': '채팅에서 검토하고 확정',
  'trade.confirmNote': '봇이 서명된 미리보기를 보여줍니다 — 채팅에서 확인하기 전까지는 아무것도 실행되지 않습니다.',
  'trade.reviewInChat': '채팅에서 {lev}x {side} 검토',

  'settings.title': '설정',
  'settings.subtitle': '봇 계정과 동기화됨',
  'settings.openInTgTitle': 'Telegram에서 FxAeon 열기',
  'settings.openInTgBody': '설정은 봇 계정과 동기화됩니다.',
  'settings.cantSyncTitle': '이 화면에서는 설정을 동기화할 수 없습니다',
  'settings.cantSyncNoInit':
    '이 실행 방식은 Telegram 자격 증명을 전달하지 않습니다. 채팅에서 /settings를 사용하세요.',
  'settings.cantSyncNoBackend':
    '이 빌드는 아직 거래 백엔드에 연결되지 않았습니다. 채팅에서 /settings를 사용하세요.',
  'settings.language': '언어',
  'settings.maxSlippage': '최대 슬리피지',
  'settings.mevProtection': 'MEV 보호',
  'settings.privateTx': '비공개 트랜잭션',
  'settings.privateTxSub': '비공개 릴레이를 통해 전송',

  'deposit.title': '입금',
  'deposit.subtitle': '지갑에 입금',
  'deposit.address': '주소',
  'deposit.mainnetOnlyBold': 'Ethereum 메인넷만.',
  'deposit.mainnetOnlyBody': '위 토큰만 보내세요 — 그 외에는 영구히 손실될 수 있습니다.',
  'deposit.unavailableTitle': '주소를 사용할 수 없습니다',
  'deposit.noAddress':
    '지갑 주소가 전달되지 않았습니다. 봇 채팅에서 /deposit를 사용하거나 봇 버튼으로 이 화면을 여세요.',
  'deposit.noWallet': '아직 지갑이 없습니다 — 봇에 /start를 보내 만드세요.',

  'policy.title': '지갑 보안',
  'policy.subtitle': '자기수탁, 하드웨어로 보장',
  'policy.intro':
    '지갑의 키는 신뢰 실행 환경(TEE)에 저장됩니다. FxAeon은 수탁도 정책 잠금도 하지 않으며 — 봇이 무엇을 할 수 있는지는 철회 가능한 권한을 통해 당신이 결정합니다.',
  'policy.rule1Title': '당신의 키, 그게 전부입니다',
  'policy.rule1Body':
    '지갑은 당신이 직접 만들거나 가져옵니다. 키는 하드웨어 엔클레이브에 있으며 언제든 당신이 내보낼 수 있습니다 — FxAeon은 결코 볼 수 없습니다.',
  'policy.rule2Title': '봇 거래는 권한이지 기본값이 아닙니다',
  'policy.rule2Body':
    '봇은 당신의 session-signer 권한이 활성화된 동안에만 서명할 수 있습니다. 설정 → 지갑에서 철회하면 채팅 실행이 즉시 중단됩니다.',
  'policy.rule3Title': '시뮬레이션을 거친 실행',
  'policy.rule3Body':
    '채팅에서 확인된 모든 작업은 먼저 시뮬레이션됩니다. 실패할 경우 아무것도 브로드캐스트되지 않습니다 — 항상 안전하게 차단됩니다.',
  'policy.rule4Title': '명시적 확인만',
  'policy.rule4Body':
    '당신이 확인을 탭하기 전에는 어떤 트랜잭션도 생성되거나 전송되지 않습니다. 미리보기는 약 10분 후 만료됩니다.',
  'policy.footer':
    '모든 것은 설정 → 지갑에서 관리하세요: 키 내보내기, 봇 거래 활성화 또는 철회. 실시간 상태는 봇에서 /security를 확인하세요.',
  // -- login sign-in card (PrivyFlow intro) --
  'loginCard.signIn': 'FxAeon 로그인',
  'loginCard.subtitle': 'Privy 기반 자기수탁 지갑',
  'loginCard.telegram': 'Telegram으로 계속하기',
  'loginCard.email': '이메일로 계속하기',
  'loginCard.wallet': '기존 지갑 연결',
  'loginCard.terms': '계속하면 약관 및 개인정보 보호정책에 동의하는 것입니다',
  'loginCard.poweredBy': '제공',
};

export default ko;
