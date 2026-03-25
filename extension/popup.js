const BRIDGE_URL = "http://127.0.0.1:37654";

const statusText = document.getElementById("statusText");
const siteText = document.getElementById("siteText");
const pairingTokenInput = document.getElementById("pairingToken");
const saveTokenBtn = document.getElementById("saveTokenBtn");
const refreshBtn = document.getElementById("refreshBtn");
const results = document.getElementById("results");
const pairingFeedback = document.getElementById("pairingFeedback");

async function getStoredToken() {
  const stored = await chrome.storage.sync.get(["pocketVaultPairingToken"]);
  return stored.pocketVaultPairingToken || "";
}

async function setStoredToken(token) {
  await chrome.storage.sync.set({ pocketVaultPairingToken: token });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setStatus(message) {
  statusText.textContent = message;
}

function setPairingFeedback(message, isError = false) {
  pairingFeedback.textContent = message;
  pairingFeedback.classList.remove("hidden", "error");
  if (isError) {
    pairingFeedback.classList.add("error");
  }
}

function clearPairingFeedback() {
  pairingFeedback.textContent = "";
  pairingFeedback.classList.add("hidden");
  pairingFeedback.classList.remove("error");
}

function renderEmpty(message) {
  results.innerHTML = `<p class="empty-text">${message}</p>`;
}

async function callBridge(path, options = {}) {
  const token = await getStoredToken();
  const headers = {
    "Content-Type": "application/json",
    "X-PocketVault-Token": token,
    ...(options.headers || {}),
  };

  const response = await fetch(`${BRIDGE_URL}${path}`, {
    ...options,
    headers,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "PocketVault bridge request failed.");
  }

  return payload;
}

async function checkBridgeHealth() {
  const response = await fetch(`${BRIDGE_URL}/health`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "PocketVault desktop app is not reachable.");
  }

  return payload;
}

async function fillCredentials(entryId) {
  const activeTab = await getActiveTab();
  if (!activeTab?.id) {
    setStatus("No active tab was found.");
    return;
  }

  const payload = await callBridge("/v1/credentials/lookup", {
    method: "POST",
    body: JSON.stringify({ url: activeTab.url }),
  });

  const match = payload.matches.find((entry) => entry.id === entryId);
  if (!match) {
    setStatus("That login is no longer available.");
    return;
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    args: [match],
    func: (entry) => {
      function collectInputs(root, inputs = []) {
        const nodes = root.querySelectorAll ? root.querySelectorAll("input, textarea") : [];
        nodes.forEach((node) => inputs.push(node));

        const elements = root.querySelectorAll ? root.querySelectorAll("*") : [];
        elements.forEach((element) => {
          if (element.shadowRoot) {
            collectInputs(element.shadowRoot, inputs);
          }
        });

        return inputs;
      }

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

      function getInputs() {
        return collectInputs(document)
          .filter((input) => !input.disabled && !input.readOnly && isVisibleField(input));
      }

      function scoreUsernameField(input) {
        const tokens = [
          input.type,
          input.name,
          input.id,
          input.placeholder,
          input.autocomplete,
          input.getAttribute("aria-label"),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (input.type === "password") {
          return -1;
        }

        let score = 0;
        if (input.type === "email") score += 6;
        if (tokens.includes("username")) score += 8;
        if (tokens.includes("email")) score += 7;
        if (tokens.includes("login")) score += 4;
        if (tokens.includes("phone")) score -= 8;
        if (tokens.includes("search")) score -= 10;
        if (tokens.includes("email or username")) score += 10;
        if (input.autocomplete === "username" || input.autocomplete === "email") score += 8;
        if (input.type === "text") score += 2;
        return score;
      }

      function scorePasswordField(input) {
        const tokens = [
          input.type,
          input.name,
          input.id,
          input.placeholder,
          input.autocomplete,
          input.getAttribute("aria-label"),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        let score = 0;
        if (input.type === "password") score += 10;
        if (tokens.includes("password")) score += 8;
        if (input.autocomplete === "current-password") score += 8;
        if (tokens.includes("new password")) score -= 8;
        return score;
      }

      function pickBestField(inputs, scorer) {
        return inputs
          .map((input) => ({ input, score: scorer(input) }))
          .filter((item) => item.score >= 0)
          .sort((left, right) => right.score - left.score)[0]?.input || null;
      }

      function setNativeValue(element, value) {
        const prototype = element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

        element.focus();
        if (descriptor?.set) {
          descriptor.set.call(element, value);
        } else {
          element.value = value;
        }

        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "A" }));
        element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Unidentified" }));
        element.blur();
      }

      const inputs = getInputs();
      const passwordField = pickBestField(inputs, scorePasswordField);
      const usernameCandidates = inputs.filter((input) => input !== passwordField);
      const usernameField = pickBestField(usernameCandidates, scoreUsernameField);

      if (usernameField && entry.account) {
        usernameField.focus();
        setNativeValue(usernameField, entry.account);
      }

      if (passwordField && entry.password) {
        passwordField.focus();
        setNativeValue(passwordField, entry.password);
      }

      return {
        filledUsername: Boolean(usernameField),
        filledPassword: Boolean(passwordField),
        usernameFieldMeta: usernameField ? {
          type: usernameField.type,
          name: usernameField.name,
          id: usernameField.id,
          placeholder: usernameField.placeholder,
        } : null,
        passwordFieldMeta: passwordField ? {
          type: passwordField.type,
          name: passwordField.name,
          id: passwordField.id,
          placeholder: passwordField.placeholder,
        } : null,
      };
    },
  });

  const fillResult = result?.result || {};
  if (!fillResult.filledUsername && !fillResult.filledPassword) {
    setStatus("PocketVault could not find login fields on this page yet.");
    return;
  }

  if (fillResult.filledUsername && fillResult.filledPassword) {
    setStatus(`Filled ${match.site}.`);
    return;
  }

  if (fillResult.filledUsername) {
    setStatus(`Filled the username for ${match.site}.`);
    return;
  }

  setStatus(`Filled the password for ${match.site}.`);
}

function renderMatches(matches) {
  if (!matches.length) {
    renderEmpty("No matching PocketVault logins were found for this website.");
    return;
  }

  results.innerHTML = matches.map((entry) => `
    <article class="entry-card">
      <p class="entry-site">${escapeHtml(entry.site)}</p>
      <p class="entry-account">${escapeHtml(entry.account)}</p>
      ${entry.notes ? `<p class="entry-notes">${escapeHtml(entry.notes)}</p>` : ""}
      <button class="fill-button" type="button" data-entry-id="${entry.id}">Fill Login</button>
    </article>
  `).join("");

  results.querySelectorAll("[data-entry-id]").forEach((button) => {
    button.addEventListener("click", () => {
      fillCredentials(button.dataset.entryId).catch((error) => {
        console.error(error);
        setStatus(error.message);
      });
    });
  });
}

async function refreshMatches() {
  const activeTab = await getActiveTab();
  if (!activeTab?.url || !/^https?:/i.test(activeTab.url)) {
    siteText.textContent = "Current site: open a normal website tab first";
    setStatus("Open a website tab to use PocketVault autofill.");
    renderEmpty("PocketVault autofill works on normal website pages.");
    return;
  }

  let hostname = activeTab.url;
  try {
    hostname = new URL(activeTab.url).hostname;
  } catch (error) {
    hostname = activeTab.url;
  }
  siteText.textContent = `Current site: ${hostname}`;

  try {
    setStatus("Checking PocketVault desktop app...");
    await checkBridgeHealth();
    const bridgeStatus = await callBridge("/v1/status", { method: "GET" });
    setStatus(`PocketVault is unlocked with ${bridgeStatus.entryCount} available logins.`);

    const payload = await callBridge("/v1/credentials/lookup", {
      method: "POST",
      body: JSON.stringify({ url: activeTab.url }),
    });
    renderMatches(payload.matches);
  } catch (error) {
    console.error(error);
    setStatus(error.message);
    renderEmpty("Unlock PocketVault on your desktop and confirm the pairing code is correct.");
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

saveTokenBtn.addEventListener("click", async () => {
  const token = pairingTokenInput.value.trim();
  if (!token) {
    setStatus("Paste the pairing code from PocketVault first.");
    setPairingFeedback("No pairing code was entered.", true);
    return;
  }

  try {
    await setStoredToken(token);
    await checkBridgeHealth();
    setStatus("Pairing code saved.");
    setPairingFeedback("Pairing code saved in Chrome. Refreshing PocketVault matches now.");
    refreshMatches().catch((error) => {
      console.error(error);
      setStatus(error.message);
    });
  } catch (error) {
    console.error(error);
    setStatus(error.message);
    setPairingFeedback(error.message, true);
  }
});

refreshBtn.addEventListener("click", () => {
  clearPairingFeedback();
  refreshMatches().catch((error) => {
    console.error(error);
    setStatus(error.message);
  });
});

document.addEventListener("DOMContentLoaded", async () => {
  const token = await getStoredToken();
  pairingTokenInput.value = token;
  clearPairingFeedback();
  refreshMatches().catch((error) => {
    console.error(error);
    setStatus(error.message);
  });
});
