import { expect, test } from 'bun:test';
import { parseWholeNumberInput } from '../src/App';

// Number inputs accept scientific notation. Page and annual-goal controls
// must convert the whole value before their existing min/max clamping.
for (const [value, expected] of [
  ['1e2', 100], ['2E2', 200], ['1e+2', 100], ['5e1', 50],
  ['1e-2', 0], ['1.5e2', 150], ['-1e2', -100],
  ['123', 123], ['0', 0], ['12.9', 12], ['-12.9', -12], ['', 0],
] as const) {
  test(`whole numeric input ${JSON.stringify(value)} becomes ${expected}`, () => {
    expect(parseWholeNumberInput(value)).toBe(expected);
  });
}

for (const value of ['NaN', 'Infinity', '-Infinity', '1e309', '12x']) {
  test(`invalid numeric input ${JSON.stringify(value)} uses a safe zero fallback`, () => {
    expect(parseWholeNumberInput(value)).toBe(0);
  });
}
