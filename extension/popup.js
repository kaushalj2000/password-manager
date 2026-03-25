const BRIDGE_URL = "http://127.0.0.1:37654";

const statusText = document.getElementById("statusText");
const pairingTokenInput = document.getElementById("pairingToken");
const saveTokenBtn = document.getElementById("saveTokenBtn");
const refreshBtn = document.getElementById("refreshBtn");
const results = document.getElementById("results");

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

  await chrome.tabs.sendMessage(activeTab.id, {
    type: "POCKETVAULT_FILL",
    payload: match,
  });
  setStatus(`Filled ${match.site}.`);
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
    setStatus("Open a website tab to use PocketVault autofill.");
    renderEmpty("PocketVault autofill works on normal website pages.");
    return;
  }

  try {
    setStatus("Checking PocketVault desktop app...");
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
    return;
  }

  await setStoredToken(token);
  setStatus("Pairing code saved.");
  refreshMatches().catch((error) => {
    console.error(error);
    setStatus(error.message);
  });
});

refreshBtn.addEventListener("click", () => {
  refreshMatches().catch((error) => {
    console.error(error);
    setStatus(error.message);
  });
});

document.addEventListener("DOMContentLoaded", async () => {
  const token = await getStoredToken();
  pairingTokenInput.value = token;
  refreshMatches().catch((error) => {
    console.error(error);
    setStatus(error.message);
  });
});
