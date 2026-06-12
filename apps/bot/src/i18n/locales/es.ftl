# Español

## /start

start-welcome-new =
    🚀 Bienvenido a fxBot
    
    La interfaz más avanzada para f(x) Protocol — posiciones apalancadas, órdenes límite y automatización de rendimiento, todo desde Telegram.
    
    🔐 Autocustodia — crea o importa TU billetera; solo tú tienes las claves
    ⚡ Validado por simulación — nada se difunde si no simula correctamente
    🤖 Honesto por diseño — nunca números falsos
start-referral-detected = 🎁 Código de referido detectado: { $code }
start-tap-button = 👇 Toca el botón de abajo para crear o importar tu billetera.
start-create-wallet = 🔐 Configurar billetera
start-welcome-back =
    👋 ¡Bienvenido de nuevo a fxBot!
    
    Billetera: { $wallet }
start-positions =
    📊 Tienes { $count ->
        [one] 1 posición activa
       *[other] { $count } posiciones activas
    }.
start-quick-actions = Acciones rápidas: /trade /portfolio /settings
start-no-positions =
    Aún no tienes posiciones activas.
    
    Empieza con: /trade /portfolio /help
start-error =
    ❌ Ups, algo salió mal
    
    Inténtalo de nuevo en un momento. Si el problema persiste, contacta con soporte.

## /help

help-body =
    📚 Ayuda de fxBot — Guía de comandos
    
    Toca cualquier comando para usarlo, o escríbelo directamente.
    
    ⚡ Trading
      /trade — Abrir posición apalancada (1.1x–7x)
      /limit — Crear órdenes límite/stop
      /orders — Ver órdenes activas
      /mint — Pedir prestado fxUSD (sin apalancamiento)
      /redeem — Canjear fxUSD por colateral
      /repay — Pagar deuda de fxUSD
    
    💰 Rendimiento y Gobernanza
      /save — Depósito/retiro en fxSAVE
      /lock — Bloquear FXN → veFXN
      /vote — Votación de gauges
      /claim — Reclamar recompensas
    
    📊 Portafolio
      /portfolio — Ver posiciones, saldos y salud
      /deposit — Mostrar dirección de billetera + QR
      /withdraw — Enviar a dirección externa
      /bridge — Puente de fxUSD (ETH ↔ Base)
    
    🤖 Automatización
      /auto — Crear/gestionar reglas de automatización
      /refer — Tu enlace de referido + ganancias
    
    ⚙️ Configuración
      /settings — Idioma, deslizamiento, protección MEV
      /security — Políticas, auditorías, exportar datos
      /help — Este menú
    
    Características clave:
    • Sin custodia — claves en TEE de Privy
    • Sin on-ramps — fondea tu propia billetera
    • Protección MEV activable (Flashbots, gratis)
    • 6 idiomas: en, zh-CN, ko, ja, ru, es
    
    ¿Necesitas ayuda? Usa /start para reconectar o contacta con soporte.
help-error = ❌ No se pudo cargar el menú de ayuda. Prueba /start para reconectar.

## /settings

settings-overview =
    ⚙️ Configuración
    
    Idioma: { $lang }
    Deslizamiento: { $slippage }%
    Protección MEV: { $mev }
    
    Para cambiar:
    /settings lang en
    /settings slippage 1.0
    /settings mev on|off
settings-mev-on = ✅ Flashbots
settings-mev-off = ❌ Desactivada
settings-lang-set = Idioma cambiado a { $value }
settings-slippage-set = Deslizamiento configurado a { $value }%
settings-slippage-invalid = El deslizamiento debe estar entre 0.01% y { $max }%
settings-mev-enabled = Protección MEV activada (Flashbots)
settings-mev-disabled = Protección MEV desactivada
settings-unknown = Ajuste desconocido. Usa /settings para ver las opciones.

## /trade

trade-usage =
    ⚡ Abrir una posición apalancada
    
    Elige un mercado abajo, o escribe el comando completo.
    
    Uso:
    /trade <mercado> <long|short> <apalancamiento> <cantidad>
    
    Ejemplo:
    /trade wstETH long 3x 1ETH
    
    Límites de apalancamiento:
    • Long: { $minLev }x – { $maxLong }x
    • Short: { $minLev }x – { $maxShort }x

## /portfolio

portfolio-empty =
    { $partial ->
        [yes] No hay posiciones activas en los mercados que pudimos leer.
       *[no] No hay posiciones activas.
    }
    
    💡 Empieza con:
    • /trade — Abrir una posición apalancada
    • /mint — Pedir prestado fxUSD (sin apalancamiento)
    • /save — Depositar en fxSAVE para rendimiento

## Shared errors

errors-generic = ❌ Ocurrió un error. Inténtalo de nuevo.
