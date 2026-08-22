/**
 * FxAeon Native Cyberpunk Voice Announcer Engine
 *
 * Provides real-time tactical voice commentary using the browser's built-in
 * Web Speech Synthesis API. 100% offline, zero latency, zero external API costs.
 */

export type VoicePersona = 'cyberpunk' | 'hype' | 'zen';

export interface AnnouncerSettings {
  enabled: boolean;
  persona: VoicePersona;
  volume: number; // 0.0 to 1.0
  rate: number;   // 0.8 to 1.4
}

const STORAGE_KEY = 'fxaeon_announcer_settings';

const DEFAULT_SETTINGS: AnnouncerSettings = {
  enabled: true,
  persona: 'cyberpunk',
  volume: 0.9,
  rate: 1.05,
};

export function getAnnouncerSettings(): AnnouncerSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveAnnouncerSettings(settings: Partial<AnnouncerSettings>): AnnouncerSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const current = getAnnouncerSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

class Announcer {
  private getSynth(): SpeechSynthesis | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return null;
    }
    return window.speechSynthesis;
  }

  public speak(text: string, customPitch?: number, customRate?: number) {
    const synth = this.getSynth();
    if (!synth) return;

    const settings = getAnnouncerSettings();
    if (!settings.enabled) return;

    // Cancel previous utterance to avoid queue buildup
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = settings.volume;

    // Apply Persona Characteristics
    switch (settings.persona) {
      case 'cyberpunk':
        utterance.pitch = customPitch ?? 0.85; // Lower synthetic pitch
        utterance.rate = customRate ?? settings.rate;
        break;
      case 'hype':
        utterance.pitch = customPitch ?? 1.25; // Higher energetic pitch
        utterance.rate = customRate ?? (settings.rate * 1.15); // Faster hype cadence
        break;
      case 'zen':
        utterance.pitch = customPitch ?? 0.95; // Calm grounded pitch
        utterance.rate = customRate ?? (settings.rate * 0.9); // Steady cadence
        break;
    }

    // Try to pick an English voice
    const voices = synth.getVoices();
    const preferredVoice = voices.find((v) => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('David') || v.name.includes('Samantha')));
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    synth.speak(utterance);
  }

  public announceTrade(side: 'long' | 'short', leverage: number, market: string, sizeUsd?: number) {
    const settings = getAnnouncerSettings();
    const levText = `${leverage}X`;
    const notional = sizeUsd ? ` valued at $${Math.round(sizeUsd)}` : '';

    if (settings.persona === 'cyberpunk') {
      this.speak(`Execution verified. ${side.toUpperCase()} ${levText} leverage opened on ${market}${notional}. Godspeed.`);
    } else if (settings.persona === 'hype') {
      this.speak(`BOOM! New ${side.toUpperCase()} locked in at ${levText} on ${market}! Let it ride anon!`);
    } else {
      this.speak(`${market} ${side} order executed at ${levText} leverage. Risk parameters secured.`);
    }
  }

  public announceTakeProfit(roiPct: number, profitUsd?: number) {
    const settings = getAnnouncerSettings();
    const profitText = profitUsd ? `Securing $${Math.round(profitUsd)} dollars profit.` : '';

    if (settings.persona === 'cyberpunk') {
      this.speak(`Target achieved. Positive return of plus ${roiPct.toFixed(1)} percent. ${profitText}`);
    } else if (settings.persona === 'hype') {
      this.speak(`MASSIVE WIN! Take profit triggered at plus ${roiPct.toFixed(1)} percent! Giga-Chad moves!`);
    } else {
      this.speak(`Target reached at plus ${roiPct.toFixed(1)} percent. Well done on taking profits.`);
    }
  }

  public announceStopLoss(roiPct: number) {
    const settings = getAnnouncerSettings();
    if (settings.persona === 'cyberpunk') {
      this.speak(`Stop loss triggered at minus ${Math.abs(roiPct).toFixed(1)} percent. Capital preserved.`);
    } else if (settings.persona === 'hype') {
      this.speak(`Stop loss hit at minus ${Math.abs(roiPct).toFixed(1)} percent. Dust it off, we run it back!`);
    } else {
      this.speak(`Position closed at stop level. Preserving capital is the path to longevity.`);
    }
  }

  public announceRiskWarning(healthPct: number) {
    this.speak(`Warning. Collateral health dropped to ${Math.round(healthPct)} percent. Liquidation buffer is critical.`, 1.3, 1.1);
  }

  public announceWhaleMove(side: string, market: string, amountUsd: number) {
    const amountK = Math.round(amountUsd / 1000);
    this.speak(`Whale radar alert. ${amountK}k dollar ${side} detected on ${market}.`);
  }

  public announceXpClaim(xpPoints: number, rankName: string) {
    this.speak(`Plus ${xpPoints} XP claimed. Rank status: ${rankName}.`);
  }

  public testPersona(persona: VoicePersona) {
    if (persona === 'cyberpunk') {
      this.speak('Cyberpunk AI online. Neural trading link established. All systems operational.');
    } else if (persona === 'hype') {
      this.speak('LFG! Hype announcer activated! Ready to print generational wealth!');
    } else {
      this.speak('Zen trading master active. Trade with patience, discipline, and calm.');
    }
  }
}

export const announcer = new Announcer();
