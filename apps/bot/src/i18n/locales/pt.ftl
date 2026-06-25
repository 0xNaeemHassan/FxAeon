# Português (Portuguese)
# Keys + variables mirror en.ftl exactly — CI enforces parity (tests/i18n.test.ts).

## /start

start-welcome-new =
    🚀 Bem-vindo ao FxAeon
    
    A interface mais avançada para o f(x) Protocol — posições alavancadas, ordens limite e automação de rendimento, tudo pelo Telegram.
    
    🔐 Autocustódia — crie ou importe a SUA carteira; só você tem as chaves
    ⚡ Protegido por simulação — nada é transmitido sem simular sem erros
    🤖 Honesto por princípio — nunca números falsos
start-referral-detected = 🎁 Código de indicação detectado: { $code }
start-tap-button = 👇 Toque no botão abaixo para criar ou importar sua carteira.
start-create-wallet = 🔐 Configurar Carteira
start-welcome-back =
    👋 Bem-vindo de volta ao FxAeon!
    
    Carteira: { $wallet }
start-positions =
    📊 Você tem { $count ->
        [one] 1 posição ativa
       *[other] { $count } posições ativas
    }.
start-quick-actions = Ações rápidas: /trade /portfolio /settings
start-no-positions =
    Ainda não há posições ativas.
    
    Comece: /trade /portfolio /help
start-error =
    ❌ Ops, algo deu errado
    
    Tente novamente em instantes. Se o problema persistir, contate o suporte.

## /help

help-body =
    📚 Ajuda do FxAeon — Guia de Comandos
    
    Toque em qualquer comando abaixo para usá-lo, ou digite-o diretamente.
    
    ⚡ Trading
      /trade — Abrir posição alavancada (1.1x–7x)
      /limit — Colocar ordens limite/stop
      /orders — Ver ordens ativas
      /mint — Tomar fxUSD emprestado (sem alavancagem)
      /redeem — Resgatar fxSAVE de volta para fxUSD
      /repay — Pagar dívida em fxUSD
    
    💰 Rendimento e Governança
      /save — Depositar/sacar fxSAVE
      /lock — Bloquear FXN → veFXN
      /vote — Votação de gauge
      /claim — Reivindicar resgate de fxSAVE vencido
    
    📊 Portfólio
      /portfolio — Ver posições, saldos, saúde
      /history — Seu histórico de ações on-chain
      /gas — Preços de gas ao vivo
      /price — Visão geral do mercado ao vivo (preços, mcap, 24h/7d)
      /alert — Alerta de preço único (ex. /alert btc > 65000)
      /alerts — Gerenciar seus alertas de preço
      /deposit — Mostrar endereço da carteira + QR
      /withdraw — Por que os envios externos estão desativados (segurança)
      /bridge — Fazer bridge de fxUSD (ETH ↔ Base)
    
    🤖 Automação
      /auto — Regras de stop-loss / take-profit (/auto sl wstETH long 2500)
      /refer — Seu link de indicação + ganhos
    
    ⚙️ Configurações
      /settings — Idioma, slippage, proteção MEV
      /security — Políticas, auditorias, exportar dados
      /help — Este menu
    
    Principais Recursos:
    • Não custodial — chaves no Privy TEE
    • Zero on-ramps — financie sua própria carteira
    • Alternância de proteção MEV (Flashbots, grátis)
    • 8 idiomas: en, zh-CN, ko, ja, ru, es, tr, pt
    
    Precisa de ajuda? Use /start para reconectar ou contate o suporte.
help-error = ❌ Não foi possível carregar o menu de ajuda. Tente /start para reconectar.

## /settings

settings-overview =
    ⚙️ Configurações
    
    Idioma: { $lang }
    Slippage: { $slippage }%
    Proteção MEV: { $mev }
    
    Para alterar:
    /settings lang en
    /settings slippage 1.0
    /settings mev on|off
settings-mev-on = ✅ Flashbots
settings-mev-off = ❌ Desligado
settings-lang-set = Idioma definido para { $value }
settings-slippage-set = Slippage definido para { $value }%
settings-slippage-invalid = O slippage deve estar entre 0,01% e { $max }%
settings-mev-enabled = Proteção MEV ativada (Flashbots)
settings-mev-disabled = Proteção MEV desativada
settings-unknown = Configuração desconhecida. Use /settings para ver as opções.

## /trade

trade-usage =
    ⚡ Abrir uma Posição Alavancada
    
    Escolha um mercado abaixo, ou digite o comando completo.
    
    Uso:
    /trade <mercado> <long|short> <alavancagem> <quantidade>
    
    Exemplo:
    /trade wstETH long 3x 1ETH
    
    Limites de Alavancagem:
    • Long: { $minLev }x – { $maxLong }x
    • Short: { $minLev }x – { $maxShort }x

## /portfolio

portfolio-empty =
    { $partial ->
        [yes] Nenhuma posição ativa nos mercados que conseguimos ler.
       *[no] Nenhuma posição ativa.
    }
    
    💡 Comece:
    • /trade — Abrir uma posição alavancada
    • /mint — Tomar fxUSD emprestado (sem alavancagem)
    • /save — Depositar no fxSAVE para rendimento

## Shared errors

errors-generic = ❌ Ocorreu um erro. Tente novamente.
