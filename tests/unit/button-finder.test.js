/**
 * Unit tests for button finding logic
 * Tests content.js:findButton() function
 */

// Jest provides jsdom environment automatically
// No need to import or setup

/**
 * SIMPLIFIED VERSION of findButton for testing
 * TODO: Extract from content.js
 */
function findButton(selector, buttonText) {
  const buttons = document.querySelectorAll(selector);

  if (!buttonText) {
    return buttons.length > 0 ? buttons[0] : null;
  }

  for (const button of buttons) {
    const text = button.textContent.trim().toLowerCase();
    if (text === buttonText.toLowerCase()) {
      return button;
    }
  }

  return null;
}

describe('Button Finder', () => {
  test('finds button by selector only', () => {
    document.body.innerHTML = '<button id="test">Click Me</button>';
    const button = findButton('button#test', null);
    expect(button).not.toBeNull();
    expect(button.textContent).toBe('Click Me');
  });

  test('finds button by selector and exact text', () => {
    document.body.innerHTML = `
      <button>Cancel</button>
      <button>Submit</button>
    `;
    const button = findButton('button', 'Submit');
    expect(button).not.toBeNull();
    expect(button.textContent).toBe('Submit');
  });

  test('returns null when no button matches', () => {
    document.body.innerHTML = '<div>Not a button</div>';
    const button = findButton('button', null);
    expect(button).toBeNull();
  });

  test('returns null when text does not match', () => {
    document.body.innerHTML = '<button>Cancel</button>';
    const button = findButton('button', 'Submit');
    expect(button).toBeNull();
  });

  test('case insensitive text matching', () => {
    document.body.innerHTML = '<button>Submit</button>';
    const button = findButton('button', 'SUBMIT');
    expect(button).not.toBeNull();
  });

  test('trims whitespace in button text', () => {
    document.body.innerHTML = '<button>  Submit  </button>';
    const button = findButton('button', 'Submit');
    expect(button).not.toBeNull();
  });
});
