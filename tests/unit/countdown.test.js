/**
 * Unit tests for countdown state management
 * Tests content.js countdown functions
 */

// Mock state for testing
let activeCountdownInterval = null;

function abortCountdownIfActive() {
  if (activeCountdownInterval !== null) {
    clearInterval(activeCountdownInterval);
    activeCountdownInterval = null;
    return true;
  }
  return false;
}

function startCountdown(delay, onComplete) {
  // Abort any existing countdown
  abortCountdownIfActive();

  let remaining = delay;
  activeCountdownInterval = setInterval(() => {
    remaining -= 1000;
    if (remaining <= 0) {
      clearInterval(activeCountdownInterval);
      activeCountdownInterval = null;
      if (onComplete) onComplete();
    }
  }, 1000);

  return activeCountdownInterval;
}

describe('Countdown State Management', () => {
  beforeEach(() => {
    // Clear any active countdown before each test
    activeCountdownInterval = null;
  });

  afterEach(() => {
    // Clean up any remaining intervals
    if (activeCountdownInterval !== null) {
      clearInterval(activeCountdownInterval);
      activeCountdownInterval = null;
    }
  });

  test('starts countdown and calls onComplete', (done) => {
    startCountdown(1000, () => {
      expect(activeCountdownInterval).toBeNull();
      done();
    });

    expect(activeCountdownInterval).not.toBeNull();
  });

  test('aborts active countdown', () => {
    startCountdown(5000, () => {});
    expect(activeCountdownInterval).not.toBeNull();

    const aborted = abortCountdownIfActive();
    expect(aborted).toBe(true);
    expect(activeCountdownInterval).toBeNull();
  });

  test('abort returns false when no countdown active', () => {
    const aborted = abortCountdownIfActive();
    expect(aborted).toBe(false);
  });

  test('starting new countdown aborts previous', (done) => {
    let firstComplete = false;
    let secondComplete = false;

    startCountdown(2000, () => {
      firstComplete = true;
    });

    setTimeout(() => {
      startCountdown(1000, () => {
        secondComplete = true;
        expect(firstComplete).toBe(false);
        expect(secondComplete).toBe(true);
        done();
      });
    }, 500);
  });
});
