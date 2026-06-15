# Türkçe (Turkish)
# Keys + variables mirror en.ftl exactly — CI enforces parity (tests/i18n.test.ts).

## /start

start-welcome-new =
    🚀 fxBot'a hoş geldiniz
    
    f(x) Protocol için en gelişmiş arayüz — kaldıraçlı pozisyonlar, limit emirleri ve getiri otomasyonu, hepsi Telegram üzerinden.
    
    🔐 Öz saklama — KENDİ cüzdanınızı oluşturun veya içe aktarın; anahtarlar yalnızca sizde
    ⚡ Simülasyon kontrollü — temiz simüle edilmeden hiçbir şey yayınlanmaz
    🤖 Tasarımı gereği dürüst — asla sahte rakamlar yok
start-referral-detected = 🎁 Referans kodu algılandı: { $code }
start-tap-button = 👇 Cüzdanınızı oluşturmak veya içe aktarmak için aşağıdaki düğmeye dokunun.
start-create-wallet = 🔐 Cüzdanı Kur
start-welcome-back =
    👋 fxBot'a tekrar hoş geldiniz!
    
    Cüzdan: { $wallet }
start-positions =
    📊 { $count ->
        [one] 1 aktif pozisyonunuz var
       *[other] { $count } aktif pozisyonunuz var
    }.
start-quick-actions = Hızlı işlemler: /trade /portfolio /settings
start-no-positions =
    Henüz aktif pozisyon yok.
    
    Başlayın: /trade /portfolio /help
start-error =
    ❌ Hata, bir şeyler ters gitti
    
    Lütfen birazdan tekrar deneyin. Sorun devam ederse destek ile iletişime geçin.

## /help

help-body =
    📚 fxBot Yardım — Komut Kılavuzu
    
    Kullanmak için aşağıdaki herhangi bir komuta dokunun veya doğrudan yazın.
    
    ⚡ İşlem
      /trade — Kaldıraçlı pozisyon aç (1.1x–7x)
      /limit — Limit/stop emirleri ver
      /orders — Aktif emirleri görüntüle
      /mint — fxUSD ödünç al (kaldıraçsız)
      /redeem — fxSAVE'i fxUSD'ye geri dönüştür
      /repay — fxUSD borcunu öde
    
    💰 Getiri ve Yönetişim
      /save — fxSAVE yatırma/çekme
      /lock — FXN'yi kilitle → veFXN
      /vote — Gauge oylaması
      /claim — Olgunlaşan fxSAVE itfasını talep et
    
    📊 Portföy
      /portfolio — Pozisyonlar, bakiyeler, sağlık
      /history — Zincir üzeri işlem geçmişiniz
      /gas — Canlı gas fiyatları
      /price — Canlı piyasa özeti (fiyatlar, mcap, 24s/7g)
      /alert — Tek seferlik fiyat uyarısı (örn. /alert btc > 65000)
      /alerts — Fiyat uyarılarınızı yönetin
      /deposit — Cüzdan adresi + QR göster
      /withdraw — Harici gönderimler neden kapalı (güvenlik)
      /bridge — fxUSD köprüle (ETH ↔ Base)
    
    🤖 Otomasyon
      /auto — Stop-loss / take-profit kuralları (/auto sl wstETH long 2500)
      /refer — Referans bağlantınız + kazançlarınız
    
    ⚙️ Ayarlar
      /settings — Dil, kayma, MEV koruması
      /security — Politikalar, denetimler, veri dışa aktarma
      /help — Bu menü
    
    Temel Özellikler:
    • Saklama dışı — anahtarlar Privy TEE'de
    • Sıfır on-ramp — kendi cüzdanınızı fonlayın
    • MEV koruma anahtarı (Flashbots, ücretsiz)
    • 8 dil: en, zh-CN, ko, ja, ru, es, tr, pt
    
    Yardım mı lazım? Yeniden bağlanmak için /start kullanın veya destek ile iletişime geçin.
help-error = ❌ Yardım menüsü yüklenemedi. Yeniden bağlanmak için /start deneyin.

## /settings

settings-overview =
    ⚙️ Ayarlar
    
    Dil: { $lang }
    Kayma: %{ $slippage }
    MEV Koruması: { $mev }
    
    Değiştirmek için:
    /settings lang en
    /settings slippage 1.0
    /settings mev on|off
settings-mev-on = ✅ Flashbots
settings-mev-off = ❌ Kapalı
settings-lang-set = Dil { $value } olarak ayarlandı
settings-slippage-set = Kayma %{ $value } olarak ayarlandı
settings-slippage-invalid = Kayma %0.01 ile %{ $max } arasında olmalıdır
settings-mev-enabled = MEV Koruması etkinleştirildi (Flashbots)
settings-mev-disabled = MEV Koruması devre dışı bırakıldı
settings-unknown = Bilinmeyen ayar. Seçenekleri görmek için /settings kullanın.

## /trade

trade-usage =
    ⚡ Kaldıraçlı Pozisyon Aç
    
    Aşağıdan bir piyasa seçin veya komutun tamamını yazın.
    
    Kullanım:
    /trade <piyasa> <long|short> <kaldıraç> <miktar>
    
    Örnek:
    /trade wstETH long 3x 1ETH
    
    Kaldıraç Limitleri:
    • Long: { $minLev }x – { $maxLong }x
    • Short: { $minLev }x – { $maxShort }x

## /portfolio

portfolio-empty =
    { $partial ->
        [yes] Okuyabildiğimiz piyasalarda aktif pozisyon yok.
       *[no] Aktif pozisyon yok.
    }
    
    💡 Başlayın:
    • /trade — Kaldıraçlı pozisyon aç
    • /mint — fxUSD ödünç al (kaldıraçsız)
    • /save — Getiri için fxSAVE'e yatır

## Shared errors

errors-generic = ❌ Bir hata oluştu. Lütfen tekrar deneyin.
