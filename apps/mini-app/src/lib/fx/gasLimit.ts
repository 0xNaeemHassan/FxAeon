/**
 * The wallet request reserves 20% headroom above eth_estimateGas. Unused
 * units are not charged, but the account must fund the full limit at the
 * selected maximum fee per gas before a transaction can be accepted.
 */
export function gasLimitWithHeadroom(estimatedGas: bigint): bigint {
  if (estimatedGas <= 0n) throw new RangeError('estimated gas must be positive');
  return (estimatedGas * 120n + 99n) / 100n;
}

export function gasLimitMaxFeeCost(estimatedGas: bigint, maxFeePerGas: bigint): bigint {
  if (maxFeePerGas <= 0n) throw new RangeError('maximum fee per gas must be positive');
  return gasLimitWithHeadroom(estimatedGas) * maxFeePerGas;
}
