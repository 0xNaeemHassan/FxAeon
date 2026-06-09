export class FxBotError extends Error {
  constructor(message: string, public code: string, public status: number = 500, public details?: Record<string, unknown>) {
    super(message); this.name = "FxBotError";
  }
}

export class ValidationError extends FxBotError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", 400, details); this.name = "ValidationError";
  }
}

export class AuthenticationError extends FxBotError {
  constructor(message: string = "Authentication required") {
    super(message, "AUTHENTICATION_ERROR", 401); this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends FxBotError {
  constructor(message: string = "Not authorized") {
    super(message, "AUTHORIZATION_ERROR", 403); this.name = "AuthorizationError";
  }
}

export class RateLimitError extends FxBotError {
  constructor(message: string = "Rate limit exceeded", public retryAfter?: number) {
    super(message, "RATE_LIMIT_ERROR", 429); this.name = "RateLimitError";
  }
}

export class TransactionError extends FxBotError {
  constructor(message: string, public txHash?: string, public revertReason?: string) {
    super(message, "TRANSACTION_ERROR", 500, { txHash, revertReason }); this.name = "TransactionError";
  }
}

export class SimulationError extends FxBotError {
  constructor(message: string, public simulationResult?: unknown) {
    super(message, "SIMULATION_ERROR", 400, { simulationResult }); this.name = "SimulationError";
  }
}

export class InsufficientFundsError extends FxBotError {
  constructor(message: string = "Insufficient funds") {
    super(message, "INSUFFICIENT_FUNDS", 400); this.name = "InsufficientFundsError";
  }
}

export class SlippageError extends FxBotError {
  constructor(message: string = "Slippage exceeded", public expectedAmount?: string, public actualAmount?: string) {
    super(message, "SLIPPAGE_ERROR", 400, { expectedAmount, actualAmount }); this.name = "SlippageError";
  }
}

export class PositionHealthError extends FxBotError {
  constructor(message: string = "Position health critical", public healthPercent?: number, public liquidationPrice?: number) {
    super(message, "POSITION_HEALTH_ERROR", 400, { healthPercent, liquidationPrice }); this.name = "PositionHealthError";
  }
}

export class PolicyViolationError extends FxBotError {
  constructor(message: string = "Action violates Privy policy") {
    super(message, "POLICY_VIOLATION", 403); this.name = "PolicyViolationError";
  }
}

export const errorCodes = {
  VALIDATION_ERROR: "Invalid input. Please check your command and try again.",
  AUTHENTICATION_ERROR: "Please connect your wallet first with /start.",
  AUTHORIZATION_ERROR: "You don't have permission to perform this action.",
  RATE_LIMIT_ERROR: "Too many requests. Please wait a moment.",
  TRANSACTION_ERROR: "Transaction failed. Please try again.",
  SIMULATION_ERROR: "Transaction simulation failed. Please check your parameters.",
  INSUFFICIENT_FUNDS: "Insufficient funds for this transaction.",
  SLIPPAGE_ERROR: "Slippage exceeded. Try increasing slippage tolerance in /settings.",
  POSITION_HEALTH_ERROR: "Position health is critical. Consider reducing leverage.",
  POLICY_VIOLATION: "This action is not allowed by your automation policy.",
  INTERNAL_ERROR: "Something went wrong. Our team has been notified.",
} as const;

export function getUserMessage(error: FxBotError): string {
  return errorCodes[error.code as keyof typeof errorCodes] || error.message;
}
