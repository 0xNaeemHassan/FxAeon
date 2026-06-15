# Русский

## /start

start-welcome-new =
    🚀 Добро пожаловать в fxBot
    
    Самый продвинутый интерфейс для f(x) Protocol — позиции с плечом, лимитные ордера и автоматизация доходности, всё прямо в Telegram.
    
    🔐 Полное самохранение — создайте или импортируйте СВОЙ кошелёк; ключи только у вас
    ⚡ Проверка симуляцией — ничего не отправляется без чистой симуляции
    🤖 Честный по замыслу — никаких фальшивых цифр
start-referral-detected = 🎁 Обнаружен реферальный код: { $code }
start-tap-button = 👇 Нажмите кнопку ниже, чтобы создать или импортировать кошелёк.
start-create-wallet = 🔐 Настроить кошелёк
start-welcome-back =
    👋 С возвращением в fxBot!
    
    Кошелёк: { $wallet }
start-positions =
    📊 У вас { $count ->
        [one] { $count } активная позиция
        [few] { $count } активные позиции
       *[other] { $count } активных позиций
    }.
start-quick-actions = Быстрые действия: /trade /portfolio /settings
start-no-positions =
    Активных позиций пока нет.
    
    Начните с: /trade /portfolio /help
start-error =
    ❌ Упс, что-то пошло не так
    
    Попробуйте ещё раз через минуту. Если проблема не исчезнет, свяжитесь с поддержкой.

## /help

help-body =
    📚 Справка fxBot — список команд
    
    Нажмите на любую команду ниже или введите её вручную.
    
    ⚡ Торговля
      /trade — Открыть позицию с плечом (1.1x–7x)
      /limit — Лимитные/стоп-ордера
      /orders — Активные ордера
      /mint — Занять fxUSD (без плеча)
      /redeem — Обменять fxUSD на залог
      /repay — Погасить долг в fxUSD
    
    💰 Доходность и управление
      /save — Внести/вывести из fxSAVE
      /lock — Заблокировать FXN → veFXN
      /vote — Голосование за gauges
      /claim — Получить награды
    
    📊 Портфель
      /portfolio — Позиции, балансы, здоровье
      /price — Обзор рынка в реальном времени (цены, капитализация, 24ч/7д)
      /alert — Разовое ценовое оповещение (напр. /alert btc > 65000)
      /alerts — Управление ценовыми оповещениями
      /deposit — Адрес кошелька + QR
      /withdraw — Отправить на внешний адрес
      /bridge — Мост fxUSD (ETH ↔ Base)
    
    🤖 Автоматизация
      /auto — Стоп-лосс / тейк-профит (/auto sl wstETH long 2500)
      /refer — Реферальная ссылка + доход
    
    ⚙️ Настройки
      /settings — Язык, проскальзывание, защита от MEV
      /security — Политики, аудиты, экспорт данных
      /help — Это меню
    
    Ключевые особенности:
    • Некастодиальный — ключи в TEE Privy
    • Без on-ramp — пополняйте собственный кошелёк
    • Переключаемая защита от MEV (Flashbots, бесплатно)
    • 8 языков: en, zh-CN, ko, ja, ru, es, tr, pt
    
    Нужна помощь? Используйте /start для переподключения или обратитесь в поддержку.
help-error = ❌ Не удалось загрузить меню справки. Попробуйте /start для переподключения.

## /settings

settings-overview =
    ⚙️ Настройки
    
    Язык: { $lang }
    Проскальзывание: { $slippage }%
    Защита от MEV: { $mev }
    
    Чтобы изменить:
    /settings lang en
    /settings slippage 1.0
    /settings mev on|off
settings-mev-on = ✅ Flashbots
settings-mev-off = ❌ Выключена
settings-lang-set = Язык изменён на { $value }
settings-slippage-set = Проскальзывание установлено: { $value }%
settings-slippage-invalid = Проскальзывание должно быть от 0.01% до { $max }%
settings-mev-enabled = Защита от MEV включена (Flashbots)
settings-mev-disabled = Защита от MEV выключена
settings-unknown = Неизвестная настройка. Используйте /settings, чтобы увидеть опции.

## /trade

trade-usage =
    ⚡ Открыть позицию с плечом
    
    Выберите рынок ниже или введите полную команду.
    
    Формат:
    /trade <рынок> <long|short> <плечо> <сумма>
    
    Пример:
    /trade wstETH long 3x 1ETH
    
    Лимиты плеча:
    • Long: { $minLev }x – { $maxLong }x
    • Short: { $minLev }x – { $maxShort }x

## /portfolio

portfolio-empty =
    { $partial ->
        [yes] Нет активных позиций на рынках, которые удалось прочитать.
       *[no] Нет активных позиций.
    }
    
    💡 С чего начать:
    • /trade — Открыть позицию с плечом
    • /mint — Занять fxUSD (без плеча)
    • /save — Внести в fxSAVE для доходности

## Shared errors

errors-generic = ❌ Произошла ошибка. Попробуйте ещё раз.
