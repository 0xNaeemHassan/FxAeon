import assert from 'node:assert/strict';
import { test } from 'node:test';
import { positionCollateralTokenAddress, positionDebtTokenAddress, positionPoolAddress } from '../src/lib/fx/policy';
import { rawQuoteReviewFacts, routeFinancialReviewFacts } from '../src/lib/fx/reviewFormatting';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import type { OfficialFxMethod, PlannedRoute, ReviewedActionIntent, RouteDetails } from '../src/lib/fx/types';

const WALLET = '0x1111111111111111111111111111111111111111';
const UNKNOWN = '0x2222222222222222222222222222222222222222';
const operations: Record<ReviewedActionIntent['kind'], OfficialFxMethod> = {
  'position-increase': 'increasePosition',
  'position-reduce': 'reducePosition',
  'position-adjust': 'adjustPositionLeverage',
  'deposit-and-mint': 'depositAndMint',
  'repay-and-withdraw': 'repayAndWithdraw',
  'fxsave-deposit': 'depositFxSave',
  'fxsave-withdraw': 'withdrawFxSave',
  'fxsave-claim': 'getRedeemTx',
};

function opening(market: 'ETH' | 'BTC' = 'ETH', side: 'long' | 'short' = 'long', positionId = 0): Extract<ReviewedActionIntent, { kind: 'position-increase' }> {
  return {
    kind: 'position-increase',
    poolAddress: positionPoolAddress(market, side),
    positionType: side,
    positionId,
    inputTokenAddress: FX_TOKENS.USDC.address,
    inputAmount: 1_000_000n,
    nativeInput: false,
    collateralTokenAddress: positionCollateralTokenAddress(market, side),
    debtTokenAddress: positionDebtTokenAddress(market, side),
  };
}

function route(intent: ReviewedActionIntent, details: RouteDetails): PlannedRoute {
  return {
    operation: operations[intent.kind],
    walletAddress: WALLET,
    chainId: 1,
    transactions: [],
    policy: { walletAddress: WALLET, chainId: 1, reviewedAction: intent },
    details,
  };
}

test('new ETH review formats the actual quoted collateral, debt, and decimal execution price', () => {
  const planned = route(opening(), {
    colls: '670412512785242112',
    debts: '1010218412345678901234',
    executionPrice: '2500.12345678901234567890123456789',
  });
  assert.deepEqual(routeFinancialReviewFacts(planned), [
    { label: 'Execution price', value: '≈ 2,500.1234 fxUSD / stETH', title: '2500.12345678901234567890123456789 fxUSD / stETH' },
    { label: 'Estimated collateral', value: '≈ 0.67041251 wstETH', title: '0.670412512785242112 wstETH' },
    { label: 'Estimated debt', value: '≈ 1,010.21841234 fxUSD', title: '1010.218412345678901234 fxUSD' },
  ]);
  assert.deepEqual(rawQuoteReviewFacts(planned), [
    { label: 'Execution price (unrounded)', value: planned.details!.executionPrice },
    { label: 'Collateral quote (raw units)', value: planned.details!.colls },
    { label: 'Debt quote (raw units)', value: planned.details!.debts },
  ]);
});

test('BTC quote accounting uses 18 decimals, while converter output uses 8 decimals', () => {
  const planned = route(opening('BTC'), {
    colls: '123456780000000000',
    debts: '1000000000000000000000',
    executionPrice: '65000.25',
    economicLimits: [{ label: 'position input conversion minimum output', value: '12345678' }],
  });
  assert.deepEqual(routeFinancialReviewFacts(planned).map(({ label, value }) => ({ label, value })), [
    { label: 'Execution price', value: '65,000.25 fxUSD / WBTC' },
    { label: 'Estimated collateral', value: '0.12345678 WBTC' },
    { label: 'Estimated debt', value: '1,000 fxUSD' },
    { label: 'Minimum converted input', value: '0.12345678 WBTC' },
  ]);
});

test('short collateral is fxUSD and short debt retains the derivative denomination', () => {
  for (const [market, symbol] of [['ETH', 'wstETH'], ['BTC', 'WBTC']] as const) {
    const facts = routeFinancialReviewFacts(route(opening(market, 'short'), {
      colls: '1234500000000000000000', debts: '123456780000000000',
    }));
    assert.equal(facts[0].value, '1,234.5 fxUSD');
    assert.equal(facts[1].value, `0.12345678 ${symbol}`);
  }
});

test('ETH reductions use stETH accounting and the actual output-token minimum', () => {
  const intent: ReviewedActionIntent = { ...opening(), kind: 'position-reduce', positionId: 4, outputTokenAddress: FX_TOKENS.USDC.address, isClosePosition: false };
  const planned = route(intent, {
    colls: '1000000000000000000', debts: '0', minOut: '1234567',
    economicLimits: [{ label: 'position output conversion minimum output', value: '1234567' }],
  });
  const facts = routeFinancialReviewFacts(planned);
  assert.equal(facts.find((fact) => fact.label === 'Estimated collateral')?.value, '1 stETH');
  assert.equal(facts.find((fact) => fact.label === 'Estimated debt')?.value, '0 fxUSD');
  assert.deepEqual(facts.filter((fact) => fact.label.includes('Minimum received')), [
    { label: 'Minimum received', value: '1.234567 USDC', title: '1.234567 USDC' },
  ]);
  const differentQuote = routeFinancialReviewFacts({ ...planned, details: { ...planned.details, minOut: '2000000' } });
  assert.equal(differentQuote.find((fact) => fact.label === 'Minimum received')?.value, '1.234567 USDC');
  assert.equal(differentQuote.find((fact) => fact.label === 'Quoted minimum received')?.value, '2 USDC');
});

test('existing ETH increases and adjustments do not mislabel ambiguous collateral quotes', () => {
  const increase = opening('ETH', 'long', 4);
  const adjust: ReviewedActionIntent = { ...increase, kind: 'position-adjust', requestedLeverage: 2 };
  for (const intent of [increase, adjust]) {
    const planned = route(intent, { colls: '670412512785242112', debts: '1000000000000000000' });
    assert.equal(routeFinancialReviewFacts(planned).some((fact) => fact.label === 'Estimated collateral'), false);
    assert.equal(routeFinancialReviewFacts(planned).find((fact) => fact.label === 'Estimated debt')?.value, '1 fxUSD');
    assert.equal(rawQuoteReviewFacts(planned).find((fact) => fact.label === 'Collateral quote (raw units)')?.value, '670412512785242112');
  }
});

test('borrow quotes use pool accounting, not the deposit input units', () => {
  const intent: ReviewedActionIntent = {
    kind: 'deposit-and-mint', poolAddress: positionPoolAddress('ETH', 'long'), positionId: 0,
    depositTokenAddress: FX_TOKENS.USDC.address, depositAmount: 1_000_000n, nativeInput: false, mintAmount: 1n,
  };
  const facts = routeFinancialReviewFacts(route(intent, {
    colls: '1000000000000000000', debts: '2000000000000000000', executionPrice: '2500',
    economicLimits: [{ label: 'deposit conversion minimum output', value: '200000000000000000' }],
  }));
  assert.equal(facts.find((fact) => fact.label === 'Estimated collateral')?.value, '1 stETH');
  assert.equal(facts.find((fact) => fact.label === 'Estimated debt')?.value, '2 fxUSD');
  assert.equal(facts.find((fact) => fact.label === 'Minimum converted deposit')?.value, '0.2 wstETH');
  assert.equal(facts.some((fact) => fact.label === 'Execution price'), false, 'An oracle price is not a swap execution price');
});

test('repay fee padding cannot become negative displayed debt and output minimum uses chosen units', () => {
  const intent: ReviewedActionIntent = {
    kind: 'repay-and-withdraw', poolAddress: positionPoolAddress('BTC', 'long'), positionId: 7,
    minimumRepayAmount: 1n, repayTokenAddress: FX_TOKENS.fxUSD.address,
    withdrawTokenAddress: FX_TOKENS.USDC.address, withdrawAmount: 2_000_000n,
    collateralTokenAddress: FX_TOKENS.WBTC.address,
  };
  const planned = route(intent, {
    colls: '0', debts: '-1000000000',
    economicLimits: [
      { label: 'repay conversion minimum output', value: '1000000000000000000' },
      { label: 'withdraw output conversion minimum output', value: '2000000' },
    ],
  });
  const facts = routeFinancialReviewFacts(planned);
  assert.equal(facts.some((fact) => fact.label === 'Estimated debt'), false);
  assert.equal(facts.find((fact) => fact.label === 'Minimum debt repaid')?.value, '1 fxUSD');
  assert.equal(facts.find((fact) => fact.label === 'Minimum received')?.value, '2 USDC');
  assert.equal(rawQuoteReviewFacts(planned).find((fact) => fact.label === 'Debt quote (raw units)')?.value, '-1000000000');
});

test('fxSAVE deposits show independent input-conversion and share minimum units', () => {
  for (const [token, raw] of [[FX_TOKENS.USDC, '1234567'], [FX_TOKENS.fxUSD, '1234567000000000000']] as const) {
    const intent: ReviewedActionIntent = { kind: 'fxsave-deposit', tokenInAddress: token.address, amount: 1n, receiver: WALLET, directBasePool: false };
    const facts = routeFinancialReviewFacts(route(intent, {
      economicLimits: [
        { label: 'fxSAVE deposit conversion minimum output', value: raw },
        { label: 'fxSAVE minimum shares', value: '2500000000000000000' },
      ],
    }));
    assert.equal(facts[0].value, `1.234567 ${token.key}`);
    assert.equal(facts[1].value, '2.5 fxSAVE');
  }
});

test('both instant fxSAVE output legs use the destination token decimals', () => {
  const intent: ReviewedActionIntent = { kind: 'fxsave-withdraw', tokenOutAddress: FX_TOKENS.USDC.address, amount: 1n, receiver: WALLET, directBasePool: false, instant: true };
  const facts = routeFinancialReviewFacts(route(intent, {
    economicLimits: [
      { label: 'fxUSD instant output minimum output', value: '1234567' },
      { label: 'USDC instant output minimum output', value: '7654321' },
    ],
  }));
  assert.deepEqual(facts.map(({ label, value }) => ({ label, value })), [
    { label: 'Minimum received (fxUSD leg)', value: '1.234567 USDC' },
    { label: 'Minimum received (USDC leg)', value: '7.654321 USDC' },
  ]);
});

test('tiny positive amounts are not rounded to zero and huge amounts retain integer precision', () => {
  const facts = routeFinancialReviewFacts(route(opening(), { colls: '1', debts: '9007199254740993123456789000000000000000' }));
  assert.deepEqual(facts[0], { label: 'Estimated collateral', value: '<0.00000001 wstETH', title: '0.000000000000000001 wstETH' });
  assert.equal(facts[1].value, '9,007,199,254,740,993,123,456.789 fxUSD');
});

test('unrecognized units and malformed source values stay verbatim in advanced details', () => {
  const intent: ReviewedActionIntent = { ...opening(), kind: 'position-reduce', positionId: 4, outputTokenAddress: UNKNOWN, isClosePosition: false };
  const planned = route(intent, {
    colls: '-1', debts: '1e18', executionPrice: 'NaN', minOut: '1000000',
    economicLimits: [{ label: 'position output conversion minimum output', value: '1000000' }],
  });
  assert.deepEqual(routeFinancialReviewFacts(planned), [{ label: 'Additional limits', value: 'See advanced details' }]);
  assert.deepEqual(rawQuoteReviewFacts(planned).map((fact) => fact.value), ['NaN', '1000000', '-1', '1e18']);
  assert.deepEqual(planned.details?.economicLimits, [{ label: 'position output conversion minimum output', value: '1000000' }]);
  for (const invalid of ['Infinity', '-0.1', '1e3', '1.2.3', '', '0']) {
    assert.equal(routeFinancialReviewFacts(route(opening(), { executionPrice: invalid })).some((fact) => fact.label === 'Execution price'), false);
  }
});

test('interpretation requires the known network, operation, pool, and intended token pair', () => {
  const details = { colls: '1000000000000000000', debts: '1000000000000000000', executionPrice: '2500' };
  const planned = route(opening(), details);
  for (const unsupported of [
    { ...planned, policy: undefined },
    { ...planned, chainId: 8453 as const },
    { ...planned, operation: 'buildBridgeTx' as const },
    route({ ...opening(), poolAddress: UNKNOWN }, details),
    route({ ...opening(), collateralTokenAddress: FX_TOKENS.USDC.address }, details),
    route({ ...opening(), positionType: 'short' }, details),
  ]) {
    assert.deepEqual(routeFinancialReviewFacts(unsupported), []);
    assert.equal(rawQuoteReviewFacts(unsupported).length, 3);
  }
  const before = structuredClone(planned);
  routeFinancialReviewFacts(planned);
  rawQuoteReviewFacts(planned);
  assert.deepEqual(planned, before);
});
