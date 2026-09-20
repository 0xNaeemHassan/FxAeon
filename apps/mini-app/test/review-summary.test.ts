import assert from 'node:assert/strict';
import test from 'node:test';
import { splitReviewFacts } from '../src/components/review/reviewSummary';

test('keeps action essentials visible while suppressing duplicate route and leverage labels', () => {
  const result = splitReviewFacts([
    { label: 'Amount', value: '1.2345 ETH', title: '1.234567890123 ETH' },
    { label: 'Target leverage', value: '3×' },
    { label: 'Leverage', value: '3×' },
    { label: 'Route', value: 'FxRoute' },
    { label: 'Slippage', value: '0.5%' },
    { label: 'Minimum received', value: '1.2 ETH' },
    { label: 'Gas fee', value: '0.0004 ETH' },
    { label: 'Execution price', value: '2,300 fxUSD / stETH' },
    { label: 'Risk', value: 'Changing leverage can alter liquidation exposure' },
    { label: 'Risk', value: 'Changing leverage can alter liquidation exposure' },
  ]);

  assert.deepEqual(result.summary.map(({ label }) => label), [
    'Amount', 'Target leverage', 'Slippage', 'Minimum received', 'Gas fee', 'Risk',
  ]);
  assert.deepEqual(result.details.map(({ label }) => label), ['Quoted leverage', 'Route', 'Execution price']);
  assert.equal(result.summary[0].title, '1.234567890123 ETH');
});

test('keeps distinct transaction costs and multiple limits visible', () => {
  const result = splitReviewFacts([
    { label: 'Protocol fee', value: '0.1 fxUSD' },
    { label: 'Total cost', value: '0.0005 ETH' },
    { label: 'Minimum received', value: '10 fxUSD' },
    { label: 'Minimum received', value: '0.02 WBTC' },
  ]);

  assert.equal(result.summary.length, 4);
  assert.equal(result.details.length, 0);
});
