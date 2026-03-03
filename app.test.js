import vm from 'node:vm';
import fs from 'node:fs';
import { test, describe } from 'node:test';
import assert from 'node:assert';

const code = fs.readFileSync('app.js', 'utf8');

function createTestContext() {
  const context = {
    document: {
      getElementById: () => ({
        addEventListener: () => {},
        style: {},
        getContext: () => ({}),
        classList: { add: () => {}, remove: () => {}, toggle: () => {} },
        dataset: {},
        appendChild: () => {},
        insertBefore: () => {},
        contains: () => false,
        querySelector: () => null,
      })
    },
    window: { addEventListener: () => {} },
    ResizeObserver: class { observe() {} },
    t: (k) => k,
    console: console,
    performance: { now: () => 0 },
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    Math: Math,
    Number: Number,
    Promise: Promise,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

describe('angleABC', () => {
  const context = createTestContext();
  const angleABC = context.angleABC;

  test('calculates 90 degree angle correctly', () => {
    // 90 degrees: A(0,1), B(0,0), C(1,0)
    const angle = angleABC({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 });
    assert.strictEqual(Math.round(angle), 90);
  });

  test('calculates 180 degree angle correctly', () => {
    // 180 degrees: A(-1,0), B(0,0), C(1,0)
    const angle = angleABC({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 });
    assert.strictEqual(Math.round(angle), 180);
  });

  test('calculates 0 degree angle correctly', () => {
    // 0 degrees: A(1,0), B(0,0), C(1,0)
    const angle = angleABC({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 });
    assert.strictEqual(Math.round(angle), 0);
  });

  test('calculates 45 degree angle correctly', () => {
    // 45 degrees: A(1,1), B(0,0), C(1,0)
    const angle = angleABC({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 });
    assert.strictEqual(Math.round(angle), 45);
  });

  test('handles collinear points correctly', () => {
    const angle = angleABC({ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 });
    assert.strictEqual(Math.round(angle), 180);
  });

  test('returns null if any point is the same as the vertex (magnitude 0)', () => {
    // A and B are the same point
    const angle1 = angleABC({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 });
    assert.strictEqual(angle1, null);

    // C and B are the same point
    const angle2 = angleABC({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 });
    assert.strictEqual(angle2, null);
  });

  test('handles floating point precision gracefully', () => {
    // Slight imperfections that might cause cos > 1 or cos < -1
    // A(0.000000000000001, 1), B(0, 0), C(0, 2)
    const angle = angleABC({ x: 1e-15, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 2 });
    assert.strictEqual(Math.round(angle), 0);
  });
});
