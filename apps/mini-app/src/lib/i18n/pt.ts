import type { Messages } from './config';

/** Português (Portuguese) — mirrors every key in en.ts. */
const pt: Messages = {
  // -- nav (bottom tab bar) --
  'nav.home': 'Início',
  'nav.trade': 'Operar',
  'nav.deposit': 'Depositar',
  'nav.settings': 'Configurações',

  // -- common --
  'common.openBot': 'Abrir @{bot}',
  'common.openInTelegram': 'Abrir no Telegram',
  'common.copyAddress': 'Copiar endereço',
  'common.copied': 'Copiado!',
  'common.save': 'Salvar alterações',
  'common.saved': 'Salvo',
  'common.back': 'Voltar',
  'common.retry': 'Tentar novamente',
  'common.loading': 'Carregando trading do f(x) Protocol…',
  'common.unknownError': 'Erro desconhecido',

  // -- browser splash (app/page.tsx) --
  'splash.tagline':
    'Trading alavancado não custodial no f(x) Protocol, feito para o Telegram. Este app roda dentro do bot FxAeon.',

  // -- login gates (app/login/page.tsx) --
  'loginGate.tgTitle': 'O FxAeon roda dentro do Telegram',
  'loginGate.tgBody': 'Abra o bot e envie /start para configurar sua carteira.',
  'loginGate.notConfTitle': 'Serviço de carteira não configurado',
  'loginGate.notConfBody':
    'Esta build está sem o app id do Privy, então a configuração da carteira não pode rodar. Se você é o operador: defina NEXT_PUBLIC_PRIVY_APP_ID (e NEXT_PUBLIC_PRIVY_SIGNER_ID para trading via bot) e implante novamente.',

  // -- onboarding intro (PrivyFlow intro screen) --
  'intro.titleLead': 'Opere f(x) como se fosse',
  'intro.titleAccent': 'uma mensagem',
  'intro.subtitle': 'Crie ou importe sua própria carteira — autocustódia, sem e-mail, sem concessões.',
  'intro.prop1Title': 'Sua carteira, suas chaves',
  'intro.prop1Body':
    'Crie uma nova carteira ou importe a sua. As chaves ficam em um enclave seguro — exportáveis por você, invisíveis para nós.',
  'intro.prop2Title': 'Opere pelo chat',
  'intro.prop2Body':
    'Abra posições alavancadas em wstETH e WBTC com uma mensagem. Confirme com um toque.',
  'intro.prop3Title': 'Você permanece no controle',
  'intro.prop3Body':
    'O trading via bot é uma permissão que VOCÊ concede — e pode revogar a qualquer momento. Nada assina sem ela.',
  'intro.referralPre': '🎁 Indicação',
  'intro.referralPost': 'será aplicada',
  'intro.ctaSetup': 'Configurar minha carteira',
  'intro.ctaConnecting': 'Conectando…',
  'intro.ctaMore': 'Mais opções de login (Google, carteira…)',
  'intro.footer': 'Login pelo Telegram por padrão · Chaves protegidas por enclaves de hardware · Exportáveis a qualquer momento',

  // -- portfolio --
  'portfolio.title': 'Portfólio',
  'portfolio.openInTgTitle': 'Abrir o FxAeon no Telegram',
  'portfolio.openInTgBody': 'Seu portfólio fica no app do Telegram.',
  'portfolio.degradedTitle': 'Dados ao vivo não estão disponíveis nesta tela',
  'portfolio.degradedNoInit':
    'Este tipo de abertura não carrega as credenciais do Telegram. Use /portfolio no chat, ou abra o app a partir de um botão do bot.',
  'portfolio.degradedNoBackend':
    'Esta build ainda não está conectada ao backend de trading. Use /portfolio no chat para dados ao vivo.',
  'portfolio.loadFailTitle': 'Não foi possível carregar sua conta',
  'portfolio.walletLabel': 'Sua carteira',
  'portfolio.selfCustodyBadge': 'autocustódia',
  'portfolio.referralCode': 'Código de indicação',
  'portfolio.balances': 'Saldos',
  'portfolio.balancesUnavailable':
    'Os saldos on-chain estão temporariamente indisponíveis (RPC). Puxe para atualizar ou tente novamente em instantes.',
  'portfolio.fundTitle': 'Financie sua carteira para começar a operar.',
  'portfolio.fundBody': 'Envie ETH, wstETH ou WBTC para o seu endereço — depois abra sua primeira posição.',
  'portfolio.showDeposit': 'Mostrar endereço de depósito',
  'portfolio.positions': 'Posições',
  'portfolio.positionsIncomplete':
    'Algumas leituras on-chain falharam — as posições exibidas podem estar incompletas. Atualize para tentar novamente.',
  'portfolio.noPositionsTitle': 'Nenhuma posição aberta',
  'portfolio.noPositionsBody': 'Abra uma posição alavancada em wstETH ou WBTC — leva cerca de 30 segundos.',
  'portfolio.setupTrade': 'Configurar uma operação',
  'portfolio.markets': 'Mercados',
  'portfolio.pricesStale': 'Os preços podem estar alguns minutos atrasados (instabilidade na origem).',
  'portfolio.quickActions': 'Ações rápidas',
  'portfolio.qaTradeHint': 'Alavancagem de até 10x',
  'portfolio.qaDepositHint': 'ETH · wstETH · WBTC',
  'portfolio.qaSecurity': 'Como sua carteira é protegida',
  'portfolio.qaSecurityHint': 'Autocustódia, suas chaves',
  'portfolio.colCollateral': 'Garantia',
  'portfolio.colPnl': 'PnL',
  'portfolio.colHealth': 'Saúde',
  'portfolio.long': 'long',
  'portfolio.short': 'short',
  'portfolio.totalValue': 'Valor Total',
  'portfolio.valueUnavailable': 'Avaliação ao vivo indisponível',
  'portfolio.pnlUnrealized': 'PnL não realizado',
  'portfolio.tabPositions': 'Posições',
  'portfolio.tabFxusd': 'fxUSD',
  'portfolio.fxusdEmptyTitle': 'Ainda sem poupança em fxUSD',
  'portfolio.fxusdEmptyBody': 'Deposite fxUSD no Stability Pool (fxSAVE) com /save no bot para render — sua posição aparece aqui e conta para o Valor Total.',
  'portfolio.savingsTitle': 'Stability Pool de fxUSD',
  'portfolio.savingsShares': '{shares} cotas',
  'portfolio.savingsRedeemReady': 'Pronto para resgatar — execute /claim',
  'portfolio.savingsRedeemPending': 'Saque em período de espera',
  'portfolio.savingsValuePending': 'Valor atualizando',
  'portfolio.savingsIncomplete': 'Não foi possível carregar sua poupança agora — atualize para tentar novamente.',
  'portfolio.size': 'tamanho',
  'portfolio.newPosition': 'Nova Posição',

  // -- trade --
  'trade.title': 'Operar',
  'trade.subtitle': 'Posições alavancadas no f(x) Protocol',
  'trade.upTo': 'até {n}x',
  'trade.long': 'long',
  'trade.short': 'short',
  'trade.leverage': 'Alavancagem',
  'trade.maxSuffix': 'máx. {n}x ({side})',
  'trade.collateral': 'Garantia ({market})',
  'trade.totalExposure': 'Exposição total ≈',
  'trade.reviewConfirm': 'Revisar e confirmar no chat',
  'trade.confirmNote': 'O bot mostra uma prévia assinada — nada é executado até você confirmar lá.',
  'trade.reviewInChat': 'Revisar {lev}x {side} no chat',
  // -- in-app execution: review (screen 2) --
  'trade.review.title': 'Revisar Cotação',
  'trade.review.heading': 'Abrir {side} — {market} {lev}x',
  'trade.review.youPay': 'Você paga',
  'trade.review.youGet': 'Tamanho da posição',
  'trade.review.minReceived': 'Mínimo recebido',
  'trade.review.leverageNote': '~{lev}x de alavancagem',
  'trade.review.entryPrice': 'Preço de entrada',
  'trade.review.positionSize': 'Tamanho da posição',
  'trade.review.borrowed': 'Emprestado',
  'trade.review.slippage': 'Tolerância de slippage',
  'trade.review.mev': 'Proteção MEV',
  'trade.review.networkFee': 'Taxa de rede',
  'trade.review.gasMarket': 'Mercado',
  'trade.review.confirmSign': 'Confirmar e Assinar',
  'trade.review.quoting': 'Buscando cotação ao vivo…',
  'trade.review.refresh': 'Atualizar cotação',
  'trade.review.on': 'LIGADO',
  'trade.review.off': 'DESLIGADO',
  'trade.review.honestNote': 'Cotação, gas e slippage são lidos ao vivo on-chain. Nada é enviado até você Confirmar.',
  // -- gas detail (screen 3) --
  'trade.gas.title': 'Taxa de rede',
  'trade.gas.subtitle': 'EIP-1559 • Ethereum mainnet',
  'trade.gas.maxBaseFee': 'Taxa base máxima',
  'trade.gas.priorityFee': 'Taxa de prioridade',
  'trade.gas.gasLimit': 'Limite de gas',
  'trade.gas.maxCost': 'Custo máximo',
  'trade.gas.speedTitle': 'Velocidade da transação',
  'trade.gas.tier.slow': 'Lento',
  'trade.gas.tier.market': 'Mercado',
  'trade.gas.tier.fast': 'Rápido',
  'trade.gas.tierNote': 'Gorjetas de prioridade reais Lento/Mercado/Rápido de blocos recentes. O servidor re-deriva e transmite o nível que você escolher.',
  // -- executing / result (screen 5) --
  'trade.exec.signing': 'Abrindo posição…',
  'trade.exec.signingNote': 'Simulando, assinando e transmitindo. Não feche.',
  'trade.result.opened': 'Posição aberta',
  'trade.result.summary': '{market} {lev}x • {amount} {token} comprometidos',
  'trade.result.transaction': 'Transação',
  'trade.result.status': 'Status',
  'trade.result.block': 'Bloco',
  'trade.result.gasPaid': 'Gas pago',
  'trade.result.confirmations': 'Confirmações',
  'trade.result.confirmed': 'Confirmada',
  'trade.result.submitted': 'Enviada',
  'trade.result.broadcast': 'Transmitida',
  'trade.result.deduped': 'Já enviada (nenhuma duplicata enviada)',
  'trade.result.viewEtherscan': 'Ver no Etherscan',
  'trade.result.done': 'Concluído',
  'trade.result.failedTitle': 'Não foi possível abrir',
  'trade.result.tryAgain': 'Tentar novamente',
  'trade.result.enableTrading': 'Ativar trading via bot',
  'trade.result.enableNote': 'Conceda o session signer em Configurações, depois tente novamente.',

  // -- settings --
  'settings.title': 'Configurações',
  'settings.subtitle': 'Sincronizado com sua conta do bot',
  'settings.openInTgTitle': 'Abrir o FxAeon no Telegram',
  'settings.openInTgBody': 'As configurações sincronizam com sua conta do bot.',
  'settings.cantSyncTitle': 'As configurações não podem sincronizar nesta tela',
  'settings.cantSyncNoInit':
    'Este tipo de abertura não carrega as credenciais do Telegram. Use /settings no chat em vez disso.',
  'settings.cantSyncNoBackend':
    'Esta build ainda não está conectada ao backend de trading. Use /settings no chat em vez disso.',
  'settings.language': 'Idioma',
  'settings.maxSlippage': 'Slippage máximo',
  'settings.mevProtection': 'Proteção MEV',
  'settings.privateTx': 'Transações privadas',
  'settings.privateTxSub': 'Rotear por um relay privado',

  // -- deposit / qr --
  'deposit.title': 'Depositar',
  'deposit.subtitle': 'Financie sua carteira',
  'deposit.address': 'Endereço',
  'deposit.mainnetOnlyBold': 'Apenas Ethereum mainnet.',
  'deposit.mainnetOnlyBody': 'Envie apenas os tokens acima — qualquer outra coisa pode ser perdida permanentemente.',
  'deposit.unavailableTitle': 'Endereço indisponível',
  'deposit.noAddress':
    'Nenhum endereço de carteira foi informado. Use /deposit no chat do bot, ou abra esta tela a partir de um botão do bot.',
  'deposit.noWallet': 'Ainda sem carteira — envie /start ao bot para criar uma.',

  // -- policy / security --
  'policy.title': 'Segurança da carteira',
  'policy.subtitle': 'Autocustódia, imposta em hardware',
  'policy.intro':
    'As chaves da sua carteira ficam em um ambiente de execução confiável (TEE). O FxAeon não detém custódia nem trava de política — o que o bot PODE fazer é decidido por você, através de uma permissão revogável.',
  'policy.rule1Title': 'Suas chaves, ponto final',
  'policy.rule1Body':
    'Você cria ou importa a carteira você mesmo. A chave fica em um enclave de hardware, exportável por você a qualquer momento — o FxAeon nunca a vê.',
  'policy.rule2Title': 'O trading via bot é uma concessão, não um padrão',
  'policy.rule2Body':
    'O bot só pode assinar enquanto sua concessão de session signer estiver ativa. Revogue-a em Configurações → Carteira e a execução pelo chat para instantaneamente.',
  'policy.rule3Title': 'Execução protegida por simulação',
  'policy.rule3Body':
    'Toda ação confirmada no chat é simulada primeiro. Se for falhar, nada é transmitido — sempre falha de forma segura.',
  'policy.rule4Title': 'Apenas confirmações explícitas',
  'policy.rule4Body':
    'Nenhuma transação é construída ou enviada antes de você tocar em Confirmar. As prévias expiram após cerca de 10 minutos.',
  'policy.footer':
    'Gerencie tudo em Configurações → Carteira: exporte sua chave, ative ou revogue o trading via bot. Veja /security no bot para o status ao vivo.',
  // -- login sign-in card (PrivyFlow intro) --
  'loginCard.signIn': 'Entrar no FxAeon',
  'loginCard.subtitle': 'Carteira autocustodial com tecnologia Privy',
  'loginCard.telegram': 'Continuar com Telegram',
  'loginCard.email': 'Continuar com E-mail',
  'loginCard.wallet': 'Conectar carteira existente',
  'loginCard.terms': 'Ao continuar, você aceita nossos Termos e Privacidade',
  'loginCard.poweredBy': 'Desenvolvido por',
};

export default pt;
