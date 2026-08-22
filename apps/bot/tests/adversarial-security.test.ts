import { describe, expect, it } from 'vitest';
import { encodeFunctionData, erc20Abi, type Address } from 'viem';
import { ADDRESSES } from '@fxaeon/shared';
import { assertRouteAllowed, SignerPolicyError, type PolicyTx } from '../src/core/signerPolicy.js';

const ROUTER = ADDRESSES.ROUTER as Address;
const USDC = ADDRESSES.USDC as Address;
const USER = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e' as Address;
const ATTACKER = '0x000000000000000000000000000000000000dEaD' as Address;

describe('Adversarial Signer Security Boundary', () => {
  it('rejects arbitrary transfer to attacker address', () => {
    const maliciousTransfer: PolicyTx = {
      to: USDC,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [ATTACKER, 1000000000n] }),
      value: 0n,
    };

    expect(() => assertRouteAllowed([maliciousTransfer], USER, 1)).toThrow(SignerPolicyError);
  });

  it('rejects approvals targeting unknown spender contract', () => {
    const maliciousApproval: PolicyTx = {
      to: USDC,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ATTACKER, 1000000000n] }),
      value: 0n,
    };

    expect(() => assertRouteAllowed([maliciousApproval], USER, 1)).toThrow(SignerPolicyError);
  });

  it('rejects unauthorized target contract outside verified registry', () => {
    const unauthorizedCall: PolicyTx = {
      to: ATTACKER,
      data: '0x12345678' as `0x${string}`,
      value: 0n,
    };

    expect(() => assertRouteAllowed([unauthorizedCall], USER, 1)).toThrow(SignerPolicyError);
  });

  it('rejects non-whitelisted selectors on verified router', () => {
    const invalidSelectorCall: PolicyTx = {
      to: ROUTER,
      data: '0xffffffff12345678' as `0x${string}`,
      value: 0n,
    };

    expect(() => assertRouteAllowed([invalidSelectorCall], USER, 1)).toThrow(SignerPolicyError);
  });
});
