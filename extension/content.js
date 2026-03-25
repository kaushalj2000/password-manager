function isVisibleField(element) {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return style.visibility !== "hidden" &&
    style.display !== "none" &&
    rect.width > 0 &&
    rect.height > 0;
}

function findPasswordField() {
  return [...document.querySelectorAll('input[type="password"]')]
    .find((input) => !input.disabled && !input.readOnly && isVisibleField(input));
}

function findUsernameField(passwordField) {
  const selectors = [
    'input[type="email"]',
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[name*="user" i]',
    'input[name*="email" i]',
    'input[id*="user" i]',
    'input[id*="email" i]',
    'input[type="text"]',
  ];

  const candidates = [...document.querySelectorAll(selectors.join(","))]
    .filter((input) => !input.disabled && !input.readOnly && isVisibleField(input));

  if (passwordField?.form) {
    const sameForm = candidates.find((input) => input.form === passwordField.form);
    if (sameForm) {
      return sameForm;
    }
  }

  return candidates[0] || null;
}

function setNativeValue(element, value) {
  const descriptor = Object.getOwnPropertyDescriptor(element.__proto__, "value");
  descriptor.set.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "POCKETVAULT_FILL") {
    return;
  }

  const { account, password } = message.payload || {};
  const passwordField = findPasswordField();
  const usernameField = findUsernameField(passwordField);

  if (usernameField && account) {
    setNativeValue(usernameField, account);
  }

  if (passwordField && password) {
    setNativeValue(passwordField, password);
  }

  sendResponse({ ok: true });
});
