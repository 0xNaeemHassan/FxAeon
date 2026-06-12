# 한국어

## /start

start-welcome-new =
    🚀 fxBot에 오신 것을 환영합니다
    
    f(x) Protocol을 위한 가장 진보된 인터페이스 — 레버리지 포지션, 지정가 주문, 수익 자동화를 모두 Telegram에서.
    
    🔐 셀프 커스터디 — 지갑을 직접 생성하거나 가져오세요. 키는 오직 본인만 보유합니다
    ⚡ 시뮬레이션 검증 — 시뮬레이션을 통과하지 않으면 아무것도 전송되지 않습니다
    🤖 정직한 설계 — 가짜 숫자는 절대 없습니다
start-referral-detected = 🎁 추천 코드가 감지되었습니다: { $code }
start-tap-button = 👇 아래 버튼을 눌러 지갑을 생성하거나 가져오세요.
start-create-wallet = 🔐 지갑 설정
start-welcome-back =
    👋 fxBot에 다시 오신 것을 환영합니다!
    
    지갑: { $wallet }
start-positions =
    📊 활성 포지션이 { $count }개 있습니다.
start-quick-actions = 빠른 작업: /trade /portfolio /settings
start-no-positions =
    아직 활성 포지션이 없습니다.
    
    시작하기: /trade /portfolio /help
start-error =
    ❌ 문제가 발생했습니다
    
    잠시 후 다시 시도해 주세요. 문제가 계속되면 지원팀에 문의하세요.

## /help

help-body =
    📚 fxBot 도움말 — 명령어 가이드
    
    아래 명령어를 탭하거나 직접 입력하세요.
    
    ⚡ 트레이딩
      /trade — 레버리지 포지션 열기 (1.1x–7x)
      /limit — 지정가/스탑 주문
      /orders — 활성 주문 보기
      /mint — fxUSD 빌리기 (레버리지 없음)
      /redeem — fxUSD를 담보로 상환
      /repay — fxUSD 부채 상환
    
    💰 수익 및 거버넌스
      /save — fxSAVE 입출금
      /lock — FXN 잠금 → veFXN
      /vote — 게이지 투표
      /claim — 보상 수령
    
    📊 포트폴리오
      /portfolio — 포지션, 잔액, 건전성 보기
      /price — 실시간 시장 개요 (가격·시총·24h/7d)
      /alert — 일회성 가격 알림 (예: /alert btc > 65000)
      /alerts — 가격 알림 관리
      /deposit — 지갑 주소 + QR 표시
      /withdraw — 외부 주소로 전송
      /bridge — fxUSD 브리지 (ETH ↔ Base)
    
    🤖 자동화
      /auto — 자동화 규칙 생성/관리
      /refer — 추천 링크 + 수익
    
    ⚙️ 설정
      /settings — 언어, 슬리피지, MEV 보호
      /security — 정책, 감사, 데이터 내보내기
      /help — 이 메뉴
    
    주요 특징:
    • 논커스터디얼 — 키는 Privy TEE에 보관
    • 온램프 없음 — 본인 지갑에 직접 입금
    • MEV 보호 전환 (Flashbots, 무료)
    • 6개 언어: en, zh-CN, ko, ja, ru, es
    
    도움이 필요하신가요? /start 로 재연결하거나 지원팀에 문의하세요.
help-error = ❌ 도움말 메뉴를 불러오지 못했습니다. /start 로 재연결해 보세요.

## /settings

settings-overview =
    ⚙️ 설정
    
    언어: { $lang }
    슬리피지: { $slippage }%
    MEV 보호: { $mev }
    
    변경 방법:
    /settings lang en
    /settings slippage 1.0
    /settings mev on|off
settings-mev-on = ✅ Flashbots
settings-mev-off = ❌ 꺼짐
settings-lang-set = 언어가 { $value }(으)로 설정되었습니다
settings-slippage-set = 슬리피지가 { $value }%로 설정되었습니다
settings-slippage-invalid = 슬리피지는 0.01%에서 { $max }% 사이여야 합니다
settings-mev-enabled = MEV 보호가 활성화되었습니다 (Flashbots)
settings-mev-disabled = MEV 보호가 비활성화되었습니다
settings-unknown = 알 수 없는 설정입니다. /settings 로 옵션을 확인하세요.

## /trade

trade-usage =
    ⚡ 레버리지 포지션 열기
    
    아래에서 마켓을 선택하거나 전체 명령어를 입력하세요.
    
    사용법:
    /trade <마켓> <long|short> <레버리지> <수량>
    
    예시:
    /trade wstETH long 3x 1ETH
    
    레버리지 한도:
    • 롱: { $minLev }x – { $maxLong }x
    • 숏: { $minLev }x – { $maxShort }x

## /portfolio

portfolio-empty =
    { $partial ->
        [yes] 읽을 수 있었던 마켓에는 활성 포지션이 없습니다.
       *[no] 활성 포지션이 없습니다.
    }
    
    💡 시작하기:
    • /trade — 레버리지 포지션 열기
    • /mint — fxUSD 빌리기 (레버리지 없음)
    • /save — fxSAVE에 예치하여 수익 얻기

## Shared errors

errors-generic = ❌ 오류가 발생했습니다. 다시 시도해 주세요.
