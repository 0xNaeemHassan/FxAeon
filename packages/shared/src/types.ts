export interface User {
  id: string;
  telegramId: string;
  privyUserId: string;
  walletAddress: string;
  language: "en" | "zh-CN" | "ko" | "ja" | "ru" | "es";
  mevProtection: "off" | "flashbots";
  slippageBps: number;
  referralCode?: string;
  referredBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Position {
  tokenId: string;
  market: "wstETH" | "WBTC";
  side: "long" | "short";
  collateral: bigint;
  debt: bigint;
  debtRatio: number;
  leverage: number;
  liquidationPrice: number;
  healthPercent: number;
  owner: string;
}

export interface LimitOrder {
  id: string;
  userId: string;
  orderHash: string;
  status: "open" | "filled" | "cancelled" | "expired";
  positionSide: boolean; // true=long, false=short
  orderType: boolean;    // true=close, false=open
  orderSide: boolean;    // true=take-profit, false=stop-loss
  triggerPrice: bigint;
  pool: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface AutomationRule {
  id: string;
  userId: string;
  name: string;
  type: "auto-compound" | "auto-rebalance" | "dca-into-fxsave" | "dca-out" | "take-profit" | "stop-loss" | "re-lock-vefxn";
  trigger: {
    schedule?: string;
    priceCondition?: { asset: string; op: "gte" | "lte"; value: number };
    healthCondition?: { positionId: string; op: "gte" | "lte"; value: number };
  };
  action: {
    fn: string;
    params: Record<string, unknown>;
  };
  constraints: {
    maxValueUsd: number;
    minIntervalSec: number;
    deadline: string;
  };
  status: "active" | "paused" | "expired" | "failed";
  lastRun?: Date;
  failureCount: number;
  priority: number;
  createdAt: Date;
}

export interface TxRecord {
  id: string;
  userId: string;
  hash: string;
  status: "broadcasted" | "confirmed" | "reverted" | "failed";
  type: string;
  data: Record<string, unknown>;
  createdAt: Date;
}

export type NotificationCategory = "tx" | "orders" | "health" | "rewards" | "governance" | "rules";

export interface NotificationPrefs {
  userId: string;
  tx: boolean;
  orders: boolean;
  health: boolean;
  rewards: boolean;
  governance: boolean;
  rules: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
}
