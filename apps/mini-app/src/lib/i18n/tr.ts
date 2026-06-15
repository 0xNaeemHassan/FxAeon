import type { Messages } from './config';

/** Türkçe (Turkish) — mirrors every key in en.ts. */
const tr: Messages = {
  // -- nav (bottom tab bar) --
  'nav.home': 'Ana Sayfa',
  'nav.trade': 'İşlem',
  'nav.deposit': 'Yatır',
  'nav.settings': 'Ayarlar',

  // -- common --
  'common.openBot': '@{bot} aç',
  'common.openInTelegram': 'Telegram’da aç',
  'common.copyAddress': 'Adresi kopyala',
  'common.copied': 'Kopyalandı!',
  'common.save': 'Değişiklikleri kaydet',
  'common.saved': 'Kaydedildi',
  'common.back': 'Geri',
  'common.retry': 'Tekrar dene',
  'common.loading': 'f(x) Protocol işlemleri yükleniyor…',
  'common.unknownError': 'Bilinmeyen hata',

  // -- browser splash (app/page.tsx) --
  'splash.tagline':
    'f(x) Protocol üzerinde, Telegram için tasarlanmış öz saklamalı kaldıraçlı işlem. Bu uygulama FxAeon botunun içinde çalışır.',

  // -- login gates (app/login/page.tsx) --
  'loginGate.tgTitle': 'FxAeon Telegram içinde çalışır',
  'loginGate.tgBody': 'Botu açın ve cüzdanınızı kurmak için /start gönderin.',
  'loginGate.notConfTitle': 'Cüzdan hizmeti yapılandırılmadı',
  'loginGate.notConfBody':
    'Bu derlemede Privy uygulama kimliği eksik, bu yüzden cüzdan kurulumu çalışamıyor. Operatörseniz: NEXT_PUBLIC_PRIVY_APP_ID (ve bot işlemleri için NEXT_PUBLIC_PRIVY_SIGNER_ID) ayarlayıp yeniden dağıtın.',

  // -- onboarding intro (PrivyFlow intro screen) --
  'intro.titleLead': 'f(x)’i sanki',
  'intro.titleAccent': 'bir mesaj',
  'intro.subtitle': 'Kendi cüzdanınızı oluşturun veya içe aktarın — öz saklama, e-posta yok, taviz yok.',
  'intro.prop1Title': 'Cüzdanınız, anahtarlarınız',
  'intro.prop1Body':
    'Yeni bir cüzdan oluşturun veya kendinizinkini içe aktarın. Anahtarlar güvenli bir enklavda durur — sizin tarafınızdan dışa aktarılabilir, bize görünmez.',
  'intro.prop2Title': 'Sohbetten işlem yapın',
  'intro.prop2Body':
    'Bir mesajla kaldıraçlı wstETH ve WBTC pozisyonları açın. Tek dokunuşla onaylayın.',
  'intro.prop3Title': 'Kontrol sizde kalır',
  'intro.prop3Body':
    'Bot işlemi SİZİN verdiğiniz bir izindir — istediğiniz zaman geri alabilirsiniz. Onsuz hiçbir şey imzalanmaz.',
  'intro.referralPre': '🎁 Referans',
  'intro.referralPost': 'uygulanacak',
  'intro.ctaSetup': 'Cüzdanımı kur',
  'intro.ctaConnecting': 'Bağlanıyor…',
  'intro.ctaMore': 'Diğer giriş seçenekleri (Google, cüzdan…)',
  'intro.footer': 'Varsayılan Telegram girişi · Anahtarlar donanım enklavlarıyla korunur · İstediğiniz zaman dışa aktarılabilir',

  // -- portfolio --
  'portfolio.title': 'Portföy',
  'portfolio.openInTgTitle': 'FxAeon’u Telegram’da aç',
  'portfolio.openInTgBody': 'Portföyünüz Telegram uygulamasında bulunur.',
  'portfolio.degradedTitle': 'Bu ekrandan canlı veri kullanılamıyor',
  'portfolio.degradedNoInit':
    'Bu başlatma türü Telegram kimlik bilgilerini taşımaz. Sohbette /portfolio kullanın ya da uygulamayı bir bot düğmesinden açın.',
  'portfolio.degradedNoBackend':
    'Bu derleme henüz işlem arka ucuna bağlı değil. Canlı veri için sohbette /portfolio kullanın.',
  'portfolio.loadFailTitle': 'Hesabınız yüklenemedi',
  'portfolio.walletLabel': 'Cüzdanınız',
  'portfolio.selfCustodyBadge': 'öz saklama',
  'portfolio.referralCode': 'Referans kodu',
  'portfolio.balances': 'Bakiyeler',
  'portfolio.balancesUnavailable':
    'Zincir üzeri bakiyeler geçici olarak kullanılamıyor (RPC). Yenilemek için çekin veya birazdan tekrar deneyin.',
  'portfolio.fundTitle': 'İşleme başlamak için cüzdanınızı fonlayın.',
  'portfolio.fundBody': 'Adresinize ETH, wstETH veya WBTC gönderin — sonra ilk pozisyonunuzu açın.',
  'portfolio.showDeposit': 'Yatırma adresini göster',
  'portfolio.positions': 'Pozisyonlar',
  'portfolio.positionsIncomplete':
    'Bazı zincir üzeri okumalar başarısız oldu — gösterilen pozisyonlar eksik olabilir. Yeniden denemek için yenileyin.',
  'portfolio.noPositionsTitle': 'Açık pozisyon yok',
  'portfolio.noPositionsBody': 'Kaldıraçlı bir wstETH veya WBTC pozisyonu açın — yaklaşık 30 saniye sürer.',
  'portfolio.setupTrade': 'Bir işlem kur',
  'portfolio.markets': 'Piyasalar',
  'portfolio.pricesStale': 'Fiyatlar birkaç dakika eski olabilir (yukarı akış sorunu).',
  'portfolio.quickActions': 'Hızlı işlemler',
  'portfolio.qaTradeHint': '10x’e kadar kaldıraç',
  'portfolio.qaDepositHint': 'ETH · wstETH · WBTC',
  'portfolio.qaSecurity': 'Cüzdanınız nasıl korunuyor',
  'portfolio.qaSecurityHint': 'Öz saklama, anahtarlar sizde',
  'portfolio.colCollateral': 'Teminat',
  'portfolio.colPnl': 'K/Z',
  'portfolio.colHealth': 'Sağlık',
  'portfolio.long': 'long',
  'portfolio.short': 'short',
  'portfolio.totalValue': 'Toplam Değer',
  'portfolio.valueUnavailable': 'Canlı değerleme kullanılamıyor',
  'portfolio.pnlUnrealized': 'gerçekleşmemiş K/Z',
  'portfolio.tabPositions': 'Pozisyonlar',
  'portfolio.tabFxusd': 'fxUSD',
  'portfolio.fxusdEmptyTitle': 'Henüz fxUSD tasarrufu yok',
  'portfolio.fxusdEmptyBody': 'Getiri kazanmak için botta /save ile fxUSD’yi İstikrar Havuzu’na (fxSAVE) yatırın — pozisyonunuz burada görünür ve Toplam Değer’e dahil olur.',
  'portfolio.savingsTitle': 'fxUSD İstikrar Havuzu',
  'portfolio.savingsShares': '{shares} pay',
  'portfolio.savingsRedeemReady': 'Talep etmeye hazır — /claim çalıştırın',
  'portfolio.savingsRedeemPending': 'Çekim bekleme süresinde',
  'portfolio.savingsValuePending': 'Değer güncelleniyor',
  'portfolio.savingsIncomplete': 'Tasarruflarınız şu anda yüklenemedi — yeniden denemek için yenileyin.',
  'portfolio.size': 'boyut',
  'portfolio.newPosition': 'Yeni Pozisyon',

  // -- trade --
  'trade.title': 'İşlem',
  'trade.subtitle': 'f(x) Protocol üzerinde kaldıraçlı pozisyonlar',
  'trade.upTo': '{n}x’e kadar',
  'trade.long': 'long',
  'trade.short': 'short',
  'trade.leverage': 'Kaldıraç',
  'trade.maxSuffix': 'maks. {n}x ({side})',
  'trade.collateral': 'Teminat ({market})',
  'trade.totalExposure': 'Toplam pozisyon ≈',
  'trade.reviewConfirm': 'Sohbette incele ve onayla',
  'trade.confirmNote': 'Bot imzalı bir önizleme gösterir — siz orada onaylamadan hiçbir şey yürütülmez.',
  'trade.reviewInChat': 'Sohbette {lev}x {side} incele',
  // -- in-app execution: review (screen 2) --
  'trade.review.title': 'Teklifi İncele',
  'trade.review.heading': '{side} aç — {market} {lev}x',
  'trade.review.youPay': 'Ödediğiniz',
  'trade.review.youGet': 'Pozisyon boyutu',
  'trade.review.minReceived': 'Alınacak minimum',
  'trade.review.leverageNote': '~{lev}x kaldıraç',
  'trade.review.entryPrice': 'Giriş fiyatı',
  'trade.review.positionSize': 'Pozisyon boyutu',
  'trade.review.borrowed': 'Ödünç alınan',
  'trade.review.slippage': 'Kayma toleransı',
  'trade.review.mev': 'MEV Koruması',
  'trade.review.networkFee': 'Ağ ücreti',
  'trade.review.gasMarket': 'Piyasa',
  'trade.review.confirmSign': 'Onayla ve İmzala',
  'trade.review.quoting': 'Canlı teklif alınıyor…',
  'trade.review.refresh': 'Teklifi yenile',
  'trade.review.on': 'AÇIK',
  'trade.review.off': 'KAPALI',
  'trade.review.honestNote': 'Teklif, gas ve kayma zincir üzerinde canlı okunur. Onayla’ya basana kadar hiçbir şey gönderilmez.',
  // -- gas detail (screen 3) --
  'trade.gas.title': 'Ağ ücreti',
  'trade.gas.subtitle': 'EIP-1559 • Ethereum ana ağı',
  'trade.gas.maxBaseFee': 'Maks. taban ücret',
  'trade.gas.priorityFee': 'Öncelik ücreti',
  'trade.gas.gasLimit': 'Gas limiti',
  'trade.gas.maxCost': 'Maks. maliyet',
  'trade.gas.speedTitle': 'İşlem hızı',
  'trade.gas.tier.slow': 'Yavaş',
  'trade.gas.tier.market': 'Piyasa',
  'trade.gas.tier.fast': 'Hızlı',
  'trade.gas.tierNote': 'Son bloklardan gerçek Yavaş/Piyasa/Hızlı öncelik bahşişleri. Sunucu seçtiğiniz katmanı yeniden türetip yayınlar.',
  // -- executing / result (screen 5) --
  'trade.exec.signing': 'Pozisyon açılıyor…',
  'trade.exec.signingNote': 'Simüle ediliyor, imzalanıyor ve yayınlanıyor. Kapatmayın.',
  'trade.result.opened': 'Pozisyon açıldı',
  'trade.result.summary': '{market} {lev}x • {amount} {token} taahhüt edildi',
  'trade.result.transaction': 'İşlem',
  'trade.result.status': 'Durum',
  'trade.result.block': 'Blok',
  'trade.result.gasPaid': 'Ödenen gas',
  'trade.result.confirmations': 'Onaylar',
  'trade.result.confirmed': 'Onaylandı',
  'trade.result.submitted': 'Gönderildi',
  'trade.result.broadcast': 'Yayınlandı',
  'trade.result.deduped': 'Zaten gönderildi (mükerrer gönderilmedi)',
  'trade.result.viewEtherscan': 'Etherscan’de görüntüle',
  'trade.result.done': 'Tamam',
  'trade.result.failedTitle': 'Açılamadı',
  'trade.result.tryAgain': 'Tekrar dene',
  'trade.result.enableTrading': 'Bot işlemini etkinleştir',
  'trade.result.enableNote': 'Ayarlar’da oturum imzalayıcısını yetkilendirin, sonra tekrar deneyin.',

  // -- settings --
  'settings.title': 'Ayarlar',
  'settings.subtitle': 'Bot hesabınızla senkronize',
  'settings.openInTgTitle': 'FxAeon’u Telegram’da aç',
  'settings.openInTgBody': 'Ayarlar bot hesabınızla senkronize olur.',
  'settings.cantSyncTitle': 'Ayarlar bu ekrandan senkronize edilemiyor',
  'settings.cantSyncNoInit':
    'Bu başlatma türü Telegram kimlik bilgilerini taşımaz. Bunun yerine sohbette /settings kullanın.',
  'settings.cantSyncNoBackend':
    'Bu derleme henüz işlem arka ucuna bağlı değil. Bunun yerine sohbette /settings kullanın.',
  'settings.language': 'Dil',
  'settings.maxSlippage': 'Maks. kayma',
  'settings.mevProtection': 'MEV koruması',
  'settings.privateTx': 'Özel işlemler',
  'settings.privateTxSub': 'Özel bir röle üzerinden yönlendir',

  // -- deposit / qr --
  'deposit.title': 'Yatır',
  'deposit.subtitle': 'Cüzdanınızı fonlayın',
  'deposit.address': 'Adres',
  'deposit.mainnetOnlyBold': 'Yalnızca Ethereum ana ağı.',
  'deposit.mainnetOnlyBody': 'Yalnızca yukarıdaki tokenları gönderin — başka herhangi bir şey kalıcı olarak kaybolabilir.',
  'deposit.unavailableTitle': 'Adres kullanılamıyor',
  'deposit.noAddress':
    'Hiçbir cüzdan adresi iletilmedi. Bot sohbetinde /deposit kullanın ya da bu ekranı bir bot düğmesinden açın.',
  'deposit.noWallet': 'Henüz cüzdan yok — oluşturmak için bota /start gönderin.',

  // -- policy / security --
  'policy.title': 'Cüzdan güvenliği',
  'policy.subtitle': 'Öz saklama, donanımda zorunlu kılınır',
  'policy.intro':
    'Cüzdanınızın anahtarları güvenilir bir yürütme ortamında (TEE) bulunur. FxAeon hiçbir saklama veya politika kilidi tutmaz — botun NE yapabileceği, geri alınabilir bir izinle sizin tarafınızdan belirlenir.',
  'policy.rule1Title': 'Anahtarlar sizde, nokta',
  'policy.rule1Body':
    'Cüzdanı kendiniz oluşturur veya içe aktarırsınız. Anahtar bir donanım enklavında durur, istediğiniz zaman sizin tarafınızdan dışa aktarılabilir — FxAeon onu asla görmez.',
  'policy.rule2Title': 'Bot işlemi bir izindir, varsayılan değil',
  'policy.rule2Body':
    'Bot yalnızca oturum imzalayıcı izniniz etkinken imzalayabilir. Bunu Ayarlar → Cüzdan’dan geri alın, sohbet yürütmesi anında durur.',
  'policy.rule3Title': 'Simülasyon kontrollü yürütme',
  'policy.rule3Body':
    'Sohbette onaylanan her işlem önce simüle edilir. Başarısız olacaksa hiçbir şey yayınlanmaz — daima güvenli tarafta kalır.',
  'policy.rule4Title': 'Yalnızca açık onaylar',
  'policy.rule4Body':
    'Siz Onayla’ya basmadan hiçbir işlem oluşturulmaz veya gönderilmez. Önizlemeler yaklaşık 10 dakika sonra sona erer.',
  'policy.footer':
    'Her şeyi Ayarlar → Cüzdan’dan yönetin: anahtarınızı dışa aktarın, bot işlemini etkinleştirin veya geri alın. Canlı durum için botta /security’ye bakın.',
  // -- login sign-in card (PrivyFlow intro) --
  'loginCard.signIn': 'FxAeon’a giriş yap',
  'loginCard.subtitle': 'Privy destekli öz saklamalı cüzdan',
  'loginCard.telegram': 'Telegram ile devam et',
  'loginCard.email': 'E-posta ile devam et',
  'loginCard.wallet': 'Mevcut cüzdanı bağla',
  'loginCard.terms': 'Devam ederek Şartlarımızı ve Gizliliğimizi kabul edersiniz',
  'loginCard.poweredBy': 'Destekleyen',
};

export default tr;
