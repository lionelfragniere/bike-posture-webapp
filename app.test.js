const fs = require('fs');
const vm = require('vm');

const appJsContent = fs.readFileSync('./app.js', 'utf8');

// Instead of trying to run all the DOM code, we just evaluate the functions
// by creating a sandbox with just enough mock functions so it doesn't crash on load
const sandbox = {
  document: {
    getElementById: () => ({
      getContext: () => ({}),
      addEventListener: () => {},
      classList: { add: () => {}, remove: () => {} },
      style: {},
      dataset: {}
    }),
  },
  window: {
    addEventListener: () => {}
  },
  ResizeObserver: class { observe() {} },
  t: () => '',
  URL: { createObjectURL: () => {}, revokeObjectURL: () => {} },
  module: { exports: {} },
};

// Evaluate the file in the sandbox
vm.createContext(sandbox);
vm.runInContext(appJsContent, sandbox);

// Extract the evaluated torsoAngle function
const torsoAngle = sandbox.module.exports.torsoAngle;

describe('torsoAngle', () => {
  it('calculates 0 degrees for purely horizontal alignment (forward)', () => {
    // dx = 10, dy = 0 => 0 degrees
    expect(torsoAngle({x: 0, y: 0}, {x: 10, y: 0})).toBeCloseTo(0);
  });

  it('calculates 0 degrees for purely horizontal alignment (backward)', () => {
    // dx = -10, dy = 0 => 0 degrees
    expect(torsoAngle({x: 10, y: 0}, {x: 0, y: 0})).toBeCloseTo(0);
  });

  it('calculates 90 degrees for purely vertical alignment (upward)', () => {
    // dx = 0, dy = -10 => 90 degrees
    expect(torsoAngle({x: 0, y: 10}, {x: 0, y: 0})).toBeCloseTo(90);
  });

  it('calculates 90 degrees for purely vertical alignment (downward)', () => {
    // dx = 0, dy = 10 => 90 degrees
    expect(torsoAngle({x: 0, y: 0}, {x: 0, y: 10})).toBeCloseTo(90);
  });

  it('calculates 45 degrees for perfect diagonal (down-right)', () => {
    // dx = 10, dy = 10 => 45 degrees
    expect(torsoAngle({x: 0, y: 0}, {x: 10, y: 10})).toBeCloseTo(45);
  });

  it('calculates 45 degrees for perfect diagonal (up-right)', () => {
    // dx = 10, dy = -10 => 45 degrees
    expect(torsoAngle({x: 0, y: 10}, {x: 10, y: 0})).toBeCloseTo(45);
  });

  it('calculates 45 degrees for perfect diagonal (down-left)', () => {
    // dx = -10, dy = 10 => 45 degrees
    expect(torsoAngle({x: 10, y: 0}, {x: 0, y: 10})).toBeCloseTo(45);
  });

  it('calculates 45 degrees for perfect diagonal (up-left)', () => {
    // dx = -10, dy = -10 => 45 degrees
    expect(torsoAngle({x: 10, y: 10}, {x: 0, y: 0})).toBeCloseTo(45);
  });

  it('calculates arbitrary angles correctly', () => {
    // 30 degrees: dx = sqrt(3), dy = 1
    expect(torsoAngle({x: 0, y: 0}, {x: Math.sqrt(3), y: 1})).toBeCloseTo(30);

    // 60 degrees: dx = 1, dy = sqrt(3)
    expect(torsoAngle({x: 0, y: 0}, {x: 1, y: Math.sqrt(3)})).toBeCloseTo(60);
  });
});
