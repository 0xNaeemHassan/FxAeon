```mermaid
flowchart TB
    subgraph TELEGRAM["TELEGRAM LAYER"]
        TG_USER["User"]
        TG_BOT["@fxAladdinBot\ngrammY + TypeScript"]
        TG_INLINE["Inline Mode\nPrice queries"]
        TG_WEBAPP["Mini App WebView"]
    end

    subgraph MINI_APP["MINI APP — Next.js 15"]
        MA_LOGIN["/login\nPrivy auth"]
        MA_TRADE["/trade\nSimulate + sign"]
        MA_LIMIT["/limit\nEIP-712 sign"]
        MA_PORTFOLIO["/portfolio\nPositions view"]
        MA_SETTINGS["/settings\nLang, slippage, MEV"]
        MA_AUTO["/auto\nRules CRUD"]
        MA_QR["/qr\nDeposit QR"]
        MA_IMPORT["/import\nWallet import"]
        MA_POLICY["/policy\nPolicy signing"]
    end

    subgraph BACKEND["BACKEND — Node 22 on Fly.io"]
        WEBHOOK["Webhook Handler\ngrammY"]
        CMD_ROUTER["Command Router\n20 commands"]
        PRIVY_SRV["Privy Server SDK\nTEE key management"]
        FX_SDK["fx-sdk wrapper\n@aladdindao/fx-sdk@1.0.5"]
        VIEM["viem\nEIP-712 signing\nContract simulation"]
        RULE_ENG["Rule Engine\nBullMQ + Redis"]
        AI_MOD["AI Module\nSurpus Intelligence"]
        BYOK_ENC["BYOK Encryption\nlibsodium secretbox"]
        NOTIF["Notification Service\nTx / Orders / Health"]
        RATE_LIMIT["Rate Limiter\n30 msg/s global\n1 msg/s per user"]
    end

    subgraph DATA["DATA LAYER"]
        PG[("Supabase Postgres\nUsers, Positions, Orders\nRules, Audit Logs, Referrals"]
        REDIS[("Upstash Redis\nBullMQ queues\nLocks, Sessions")]
        R2[("Cloudflare R2\nDaily pg_dump backups\n30-day retention")]
    end

    subgraph BLOCKCHAIN["ETHEREUM MAINNET"]
        ALCHEMY["Alchemy RPC\nFree tier (30M CU/mo)"]
        FLASHBOTS["Flashbots Protect\nUser-toggleable, FREE"]
        FX_ROUTER["f(x) Router\n0x33636D...CC708"]
        FX_POOLS["Pool Managers\nLong/Short x4"]
        FX_LIMIT["LimitOrderManager\n0x112873...Ad96"]
        FX_SAVE["fxSAVE\n0x7743e5...fc39"]
        FX_KEEPERS["f(x) Keepers\nFill limit orders"]
    end

    subgraph EXTERNAL["EXTERNAL APIs"]
        DEFILLAMA["DefiLlama\nPrices + Yields"]
        AAVE_SUBGRAPH["Aave Subgraph\nBorrow APR"]
        FX_RELAYER["fx-limit-order-api\nPOST /v1/order\nGET /v1/order-updates"]
        SURPLUS["Surplus Intelligence\nAI inference"]
    end

    subgraph MONITORING["MONITORING"]
        UPTIME["UptimeRobot\n50 monitors (free)"]
        SENTRY["Sentry\n5k events/mo (free)"]
        POSTHOG["PostHog\n1M events/mo (free)"]
        DISCORD["Discord Webhook\nOps alerts"]
    end

    subgraph CI_CD["CI/CD — GitHub Actions"]
        CI_LINT["Lint + Typecheck"]
        CI_TEST["Test Suite"]
        CI_DEPLOY["Deploy to Fly.io"]
        CI_BACKUP["Daily pg_dump → R2"]
        CI_MONITOR["FX upgrade monitor"]
    end

    %% User flows
    TG_USER -->|"/start"| TG_BOT
    TG_USER -->|"@fxAladdinBot wsteth"| TG_INLINE
    TG_BOT -->|"Open Mini App"| TG_WEBAPP
    TG_WEBAPP -->|"HTTPS"| MINI_APP

    %% Mini App flows
    MA_LOGIN -->|"Telegram initData"| PRIVY_SRV
    MA_TRADE -->|"simulate + sign"| VIEM
    MA_LIMIT -->|"EIP-712 signTypedData"| VIEM
    MA_SETTINGS -->|"Save prefs"| PG
    MA_AUTO -->|"Create rule"| RULE_ENG
    MA_QR -->|"Show address"| PRIVY_SRV
    MA_IMPORT -->|"importWallet"| PRIVY_SRV
    MA_POLICY -->|"Sign policy"| PRIVY_SRV

    %% Backend flows
    WEBHOOK --> CMD_ROUTER
    CMD_ROUTER -->|"/trade, /limit, /auto"| FX_SDK
    CMD_ROUTER -->|"/portfolio"| PG
    FX_SDK -->|"getPositions"| ALCHEMY
    FX_SDK -->|"buildTx"| FX_ROUTER
    VIEM -->|"simulateContract"| ALCHEMY
    VIEM -->|"signTypedData"| PRIVY_SRV
    PRIVY_SRV -->|"sendTransaction"| ALCHEMY
    RULE_ENG -->|"Execute rule"| FX_SDK
    RULE_ENG -->|"Queue jobs"| REDIS
    AI_MOD -->|"explain, suggest"| SURPLUS
    BYOK_ENC -->|"encrypt/decrypt"| PG
    NOTIF -->|"Poll orders"| FX_RELAYER
    NOTIF -->|"Health alerts"| PG
    NOTIF -->|"Send message"| TG_BOT
    RATE_LIMIT -->|"Throttling"| WEBHOOK

    %% Data flows
    PG -->|"Cache positions"| FX_SDK
    PG -->|"Store rules"| RULE_ENG
    PG -->|"Audit log"| NOTIF
    REDIS -->|"BullMQ queues"| RULE_ENG
    REDIS -->|"SETNX locks"| RULE_ENG
    PG -->|"Daily backup"| CI_BACKUP
    CI_BACKUP --> R2

    %% Blockchain flows
    ALCHEMY --> FX_ROUTER
    FX_ROUTER --> FX_POOLS
    FX_ROUTER --> FX_SAVE
    FX_LIMIT -->|"EIP-712 orders"| FX_KEEPERS
    FX_KEEPERS -->|"Fill on-chain"| FX_POOLS
    ALCHEMY -.->|"MEV toggle"| FLASHBOTS

    %% External API flows
    FX_SDK -->|"Price data"| DEFILLAMA
    FX_SDK -->|"Pool yields"| DEFILLAMA
    NOTIF -->|"Order updates"| FX_RELAYER
    FX_SDK -->|"Borrow APR"| AAVE_SUBGRAPH

    %% Monitoring
    UPTIME -->|"Health check"| BACKEND
    SENTRY -->|"Error tracking"| BACKEND
    POSTHOG -->|"Analytics"| BACKEND
    BACKEND -->|"Critical alerts"| DISCORD

    %% CI/CD
    CI_LINT --> CI_TEST
    CI_TEST --> CI_DEPLOY
    CI_DEPLOY -->|"Fly.io"| BACKEND
    CI_DEPLOY -->|"Cloudflare Pages"| MINI_APP
    CI_MONITOR -->|"Weekly diff"| FX_ROUTER

    %% Security annotations
    style PRIVY_SRV fill:#e1f5fe
    style BYOK_ENC fill:#e1f5fe
    style RATE_LIMIT fill:#fff3e0
    style FLASHBOTS fill:#e8f5e9
    style FX_KEEPERS fill:#fce4ec

    classDef secure fill:#e1f5fe,stroke:#01579b
    classDef warning fill:#fff3e0,stroke:#e65100
    classDef external fill:#f3e5f5,stroke:#4a148c
    classDef blockchain fill:#e8f5e9,stroke:#1b5e20

    class PRIVY_SRV,BYOK_ENC secure
    class RATE_LIMIT warning
    class DEFILLAMA,SURPLUS,FX_RELAYER external
    class ALCHEMY,FX_ROUTER,FX_POOLS,FX_LIMIT,FX_SAVE,FX_KEEPERS blockchain
```