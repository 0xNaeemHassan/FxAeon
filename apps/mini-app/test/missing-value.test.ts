import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MissingValue, ValueOrSkeleton } from '../src/components/MissingValue';

const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
after(() => {
  if (previousReact) globalReact.React = previousReact;
  else Reflect.deleteProperty(globalThis, 'React');
});

function render(element: React.ReactElement) {
  return renderToStaticMarkup(element);
}

test('missing value placeholders distinguish unknown reads from verified values', () => {
  const loading = render(React.createElement(ValueOrSkeleton, { value: '—' }));
  assert.match(loading, /class="missing-value missing-value-md"/);
  assert.match(loading, /aria-label="Loading value"/);
  assert.match(loading, /aria-hidden="true"/);

  const shortDash = render(React.createElement(ValueOrSkeleton, { value: '-' }));
  assert.match(shortDash, /class="missing-value missing-value-md"/);

  const zero = render(React.createElement(ValueOrSkeleton, { value: '0' }));
  const negative = render(React.createElement(ValueOrSkeleton, { value: '-2.50' }));
  assert.equal(zero, '0');
  assert.equal(negative, '-2.50');
  assert.doesNotMatch(zero, /missing-value/);
  assert.doesNotMatch(negative, /missing-value/);
});

test('unavailable placeholders are neutral, explicit, and support value or children', () => {
  const unavailable = render(React.createElement(MissingValue, { status: 'unavailable', width: 'sm' }));
  assert.match(unavailable, /missing-value-sm missing-value-unavailable/);
  assert.match(unavailable, /aria-label="Value unavailable"/);
  assert.doesNotMatch(unavailable, /aria-label="Loading value"/);
  assert.match(unavailable, /class="missing-value-bar" aria-hidden="true"/);
  assert.doesNotMatch(unavailable, />—</);

  const unavailableByLoading = render(React.createElement(MissingValue, { loading: false }));
  assert.match(unavailableByLoading, /missing-value-unavailable/);
  assert.match(unavailableByLoading, /aria-label="Value unavailable"/);

  const composed = React.createElement('span', { className: 'composed-value' }, '—');
  const composedHtml = render(React.createElement(ValueOrSkeleton, { value: composed }));
  assert.match(composedHtml, /class="composed-value"/);
  assert.match(composedHtml, />—<\/span>/);

  const childrenHtml = render(React.createElement(ValueOrSkeleton, null, '—'));
  assert.match(childrenHtml, /missing-value/);

  const wide = render(React.createElement(ValueOrSkeleton, { value: '—', width: 'xl' }));
  assert.match(wide, /missing-value-xl/);
  assert.doesNotMatch(wide, /style=/);
});
