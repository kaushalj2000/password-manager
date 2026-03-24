const LEGACY_STORAGE_KEY = "vault-password-manager-entries";
const ITERATIONS = 250000;
const AUTO_LOCK_STORAGE_KEY = "password-manager-auto-lock-minutes";
const AUTO_LOCK_WARNING_MS = 30000;
const LAST_VAULT_TARGET_KEY = "password-manager-last-vault-target";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const authOverlay = document.getElementById("authOverlay");
const appShell = document.getElementById("appShell");
const authTitle = document.getElementById("authTitle");
const authDescription = document.getElementById("authDescription");
const authActionGrid = document.getElementById("authActionGrid");
const migrationNote = document.getElementById("migrationNote");
const fileSupportWarning = document.getElementById("fileSupportWarning");
const selectedFileCard = document.getElementById("selectedFileCard");
const selectedFileName = document.getElementById("selectedFileName");
const setupForm = document.getElementById("setupForm");
const unlockForm = document.getElementById("unlockForm");
const setupPasswordInput = document.getElementById("setupPassword");
const confirmPasswordInput = document.getElementById("confirmPassword");
const unlockPasswordInput = document.getElementById("unlockPassword");
const createVaultFileBtn = document.getElementById("createVaultFileBtn");
const openVaultFileBtn = document.getElementById("openVaultFileBtn");
const lockVaultBtn = document.getElementById("lockVaultBtn");
const activeVaultName = document.getElementById("activeVaultName");
const importGoogleBtn = document.getElementById("importGoogleBtn");
const exportBackupBtn = document.getElementById("exportBackupBtn");
const importBackupBtn = document.getElementById("importBackupBtn");
const importBackupInput = document.getElementById("importBackupInput");
const importGoogleInput = document.getElementById("importGoogleInput");
const autoLockSelect = document.getElementById("autoLockSelect");
const autoLockWarning = document.getElementById("autoLockWarning");
const updateStatusText = document.getElementById("updateStatusText");
const updateActionBtn = document.getElementById("updateActionBtn");

const form = document.getElementById("passwordForm");
const entryIdInput = document.getElementById("entryId");
const siteNameInput = document.getElementById("siteName");
const accountNameInput = document.getElementById("accountName");
const passwordValueInput = document.getElementById("passwordValue");
const notesInput = document.getElementById("notes");
const searchInput = document.getElementById("searchInput");
const generatedPasswordInput = document.getElementById("generatedPassword");
const lengthRange = document.getElementById("lengthRange");
const lengthValue = document.getElementById("lengthValue");
const includeUppercase = document.getElementById("includeUppercase");
const includeLowercase = document.getElementById("includeLowercase");
const includeNumbers = document.getElementById("includeNumbers");
const includeSymbols = document.getElementById("includeSymbols");
const generateBtn = document.getElementById("generateBtn");
const copyGeneratedBtn = document.getElementById("copyGeneratedBtn");
const useGeneratedBtn = document.getElementById("useGeneratedBtn");
const togglePasswordBtn = document.getElementById("togglePasswordBtn");
const clearFormBtn = document.getElementById("clearFormBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const entryList = document.getElementById("entryList");
const entryCount = document.getElementById("entryCount");
const strengthText = document.getElementById("strengthText");
const toast = document.getElementById("toast");
const formTitle = document.getElementById("formTitle");
const saveBtn = document.getElementById("saveBtn");

let entries = [];
let sessionKey = null;
let vaultTarget = null;
let vaultMetadata = null;
let toastTimer;
let autoLockTimer;
let autoLockWarningTimer;
let updateState = {
  status: "idle",
  message: "Auto-update status will appear here.",
};
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "mousemove", "scroll", "touchstart"];

function normalizeEntries(rawEntries) {
  return rawEntries.map((entry) => ({
    ...entry,
    pinned: Boolean(entry.pinned),
  }));
}

function loadLegacyEntries() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error("Failed to load legacy vault", error);
    return [];
  }
}

function supportsVaultFiles() {
  return Boolean(
    window.crypto?.subtle &&
    window.crypto.getRandomValues &&
    (
      window.desktopAPI ||
      (window.showOpenFilePicker && window.showSaveFilePicker)
    ),
  );
}

function persistVaultTarget() {
  if (!window.desktopAPI || !vaultTarget?.filePath) {
    return;
  }

  localStorage.setItem(LAST_VAULT_TARGET_KEY, JSON.stringify({
    type: vaultTarget.type,
    filePath: vaultTarget.filePath,
    name: vaultTarget.name,
  }));
}

function clearPersistedVaultTarget() {
  localStorage.removeItem(LAST_VAULT_TARGET_KEY);
}

function loadPersistedVaultTarget() {
  if (!window.desktopAPI) {
    return null;
  }

  try {
    const raw = localStorage.getItem(LAST_VAULT_TARGET_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error("Failed to load saved vault target", error);
    return null;
  }
}

function randomBytes(length) {
  const values = new Uint8Array(length);
  window.crypto.getRandomValues(values);
  return values;
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveAesKey(password, saltBytes, iterations = ITERATIONS) {
  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptText(key, plainText) {
  const iv = randomBytes(12);
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    textEncoder.encode(plainText),
  );

  return {
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  };
}

async function decryptText(key, payload) {
  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.data),
  );

  return textDecoder.decode(decrypted);
}

function getVaultFileOptions() {
  return {
    types: [
      {
        description: "Encrypted Password Vault",
        accept: { "application/json": [".vault"] },
      },
    ],
    excludeAcceptAllOption: true,
  };
}

function updateSelectedFileUi() {
  if (!vaultTarget) {
    selectedFileCard.classList.add("hidden");
    activeVaultName.textContent = "No file opened";
    return;
  }

  selectedFileCard.classList.remove("hidden");
  selectedFileName.textContent = vaultTarget.name;
  activeVaultName.textContent = vaultTarget.name;
}

function getRememberedVaultTarget() {
  return vaultTarget || loadPersistedVaultTarget();
}

function showUnlockForCurrentVault() {
  if (!vaultTarget) {
    vaultTarget = loadPersistedVaultTarget();
  }

  if (!vaultTarget) {
    showAuthHome();
    return;
  }

  authOverlay.classList.remove("hidden");
  appShell.classList.add("app-hidden");
  appShell.setAttribute("aria-hidden", "true");
  authActionGrid.classList.add("hidden");
  setupForm.classList.add("hidden");
  unlockForm.classList.remove("hidden");
  updateSelectedFileUi();
  authTitle.textContent = "Unlock your vault";
  authDescription.textContent = "Enter your master password to unlock the same encrypted vault file you used last time.";
}

async function pickNewVaultFile() {
  if (window.desktopAPI) {
    const result = await window.desktopAPI.saveVaultFile("pocketvault.vault");
    if (result?.canceled || !result?.filePath) {
      return;
    }

    vaultTarget = {
      type: "desktop",
      filePath: result.filePath,
      name: result.name,
    };
  } else {
    const handle = await window.showSaveFilePicker({
      ...getVaultFileOptions(),
      suggestedName: "pocketvault.vault",
    });

    vaultTarget = {
      type: "browser",
      handle,
      name: handle.name,
    };
  }

  vaultMetadata = null;
  updateSelectedFileUi();
  authActionGrid.classList.add("hidden");
  setupForm.classList.remove("hidden");
  unlockForm.classList.add("hidden");
  authTitle.textContent = "Create your encrypted vault";
  authDescription.textContent = "This vault file will be saved on disk. Put it in a sync folder to use it across devices.";
}

async function pickExistingVaultFile() {
  if (window.desktopAPI) {
    const result = await window.desktopAPI.openVaultFile();
    if (result?.canceled || !result?.filePath) {
      return;
    }

    vaultTarget = {
      type: "desktop",
      filePath: result.filePath,
      name: result.name,
    };
  } else {
    const [handle] = await window.showOpenFilePicker(getVaultFileOptions());
    vaultTarget = {
      type: "browser",
      handle,
      name: handle.name,
    };
  }

  updateSelectedFileUi();

  try {
    vaultMetadata = await readVaultFile();
    persistVaultTarget();
    showUnlockForCurrentVault();
  } catch (error) {
    console.error(error);
    showToast("That file is not a valid vault file.");
    vaultTarget = null;
    vaultMetadata = null;
    clearPersistedVaultTarget();
    updateSelectedFileUi();
    authActionGrid.classList.remove("hidden");
  }
}

async function readVaultFile() {
  if (!vaultTarget) {
    throw new Error("No vault file selected.");
  }

  let content = "";

  if (vaultTarget.type === "desktop") {
    content = await window.desktopAPI.readVaultFile(vaultTarget.filePath);
  } else {
    const file = await vaultTarget.handle.getFile();
    content = await file.text();
  }

  if (!content.trim()) {
    throw new Error("Vault file is empty.");
  }

  const parsed = JSON.parse(content);

  if (!parsed?.salt || !parsed?.vault || !parsed?.verifier) {
    throw new Error("Invalid vault file contents.");
  }

  return parsed;
}

async function writeVaultFile(data) {
  if (!vaultTarget) {
    throw new Error("No vault file selected.");
  }

  const serialized = JSON.stringify(data, null, 2);

  if (vaultTarget.type === "desktop") {
    await window.desktopAPI.writeVaultFile(vaultTarget.filePath, serialized);
  } else {
    const writable = await vaultTarget.handle.createWritable();
    await writable.write(serialized);
    await writable.close();
  }

  vaultMetadata = data;
}

async function migrateLegacyEntriesIntoFile() {
  const legacyEntries = loadLegacyEntries();

  if (!legacyEntries.length) {
    return [];
  }

  localStorage.removeItem(LEGACY_STORAGE_KEY);
  return legacyEntries;
}

async function createVaultFile(masterPassword) {
  const salt = randomBytes(16);
  const key = await deriveAesKey(masterPassword, salt);
  const importedEntries = normalizeEntries(await migrateLegacyEntriesIntoFile());
  const verifier = await encryptText(key, "vault-check");
  const vault = await encryptText(key, JSON.stringify(importedEntries));

  const payload = {
    version: 1,
    iterations: ITERATIONS,
    salt: bytesToBase64(salt),
    verifier,
    vault,
    updatedAt: new Date().toISOString(),
  };

  await writeVaultFile(payload);
  sessionKey = key;
  entries = importedEntries;
  persistVaultTarget();
  resetAutoLockTimer();
}

async function unlockVault(masterPassword) {
  if (!vaultMetadata) {
    throw new Error("No vault metadata loaded.");
  }

  const key = await deriveAesKey(
    masterPassword,
    base64ToBytes(vaultMetadata.salt),
    vaultMetadata.iterations || ITERATIONS,
  );

  const verifier = await decryptText(key, vaultMetadata.verifier);
  if (verifier !== "vault-check") {
    throw new Error("Invalid master password.");
  }

  const decryptedVault = await decryptText(key, vaultMetadata.vault);
  sessionKey = key;
  entries = normalizeEntries(JSON.parse(decryptedVault));
  resetAutoLockTimer();
}

async function persistVault() {
  if (!sessionKey || !vaultMetadata) {
    throw new Error("Vault is locked.");
  }

  vaultMetadata.vault = await encryptText(sessionKey, JSON.stringify(entries));
  vaultMetadata.updatedAt = new Date().toISOString();
  await writeVaultFile(vaultMetadata);
}

function lockVault() {
  const rememberedVaultTarget = getRememberedVaultTarget();
  sessionKey = null;
  entries = [];
  vaultMetadata = null;
  stopAutoLockTimer();
  resetForm();
  unlockForm.reset();
  searchInput.value = "";
  renderEntries();
  vaultTarget = rememberedVaultTarget;
  if (vaultTarget) {
    showUnlockForCurrentVault();
  } else {
    showAuthHome();
  }
  showToast("Vault locked.");
}

function showAuthHome() {
  authOverlay.classList.remove("hidden");
  appShell.classList.add("app-hidden");
  appShell.setAttribute("aria-hidden", "true");
  authActionGrid.classList.remove("hidden");
  setupForm.classList.add("hidden");
  unlockForm.classList.add("hidden");
  authTitle.textContent = "Choose your vault file";
  authDescription.textContent = "Create a permanent encrypted vault file on disk, then place it in OneDrive, Google Drive, Dropbox, or another sync folder for cross-device access.";
  if (!vaultTarget) {
    updateSelectedFileUi();
  }
}

function showApp() {
  authOverlay.classList.add("hidden");
  appShell.classList.remove("app-hidden");
  appShell.setAttribute("aria-hidden", "false");
  updateSelectedFileUi();
  resetAutoLockTimer();
}

function getAutoLockMinutes() {
  return Number(autoLockSelect.value);
}

function hideAutoLockWarning() {
  autoLockWarning.classList.add("hidden");
}

function showAutoLockWarning(secondsRemaining) {
  autoLockWarning.querySelector(".auto-lock-warning-text").textContent = `Vault will auto-lock in ${secondsRemaining} second${secondsRemaining === 1 ? "" : "s"} unless you use the app.`;
  autoLockWarning.classList.remove("hidden");
}

function stopAutoLockTimer() {
  clearTimeout(autoLockTimer);
  autoLockTimer = null;
  clearInterval(autoLockWarningTimer);
  autoLockWarningTimer = null;
  hideAutoLockWarning();
}

function resetAutoLockTimer() {
  stopAutoLockTimer();

  if (!sessionKey) {
    return;
  }

  const minutes = getAutoLockMinutes();
  if (minutes <= 0) {
    return;
  }

  const totalMs = minutes * 60 * 1000;
  const warningDelay = totalMs - AUTO_LOCK_WARNING_MS;

  if (warningDelay > 0) {
    autoLockWarningTimer = setTimeout(() => {
      let secondsRemaining = Math.ceil(AUTO_LOCK_WARNING_MS / 1000);
      showAutoLockWarning(secondsRemaining);

      autoLockWarningTimer = setInterval(() => {
        secondsRemaining -= 1;
        if (secondsRemaining > 0) {
          showAutoLockWarning(secondsRemaining);
        }
      }, 1000);
    }, warningDelay);
  }

  autoLockTimer = setTimeout(() => {
    lockVault();
    showToast("Vault auto-locked after inactivity.");
  }, totalMs);
}

function registerActivityTracking() {
  ACTIVITY_EVENTS.forEach((eventName) => {
    document.addEventListener(eventName, () => {
      if (sessionKey) {
        resetAutoLockTimer();
      }
    });
  });
}

function generatePassword() {
  const selections = [
    includeUppercase.checked ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ" : "",
    includeLowercase.checked ? "abcdefghijklmnopqrstuvwxyz" : "",
    includeNumbers.checked ? "0123456789" : "",
    includeSymbols.checked ? "!@#$%^&*()_+-=[]{};:,.<>?" : "",
  ].filter(Boolean);

  if (!selections.length) {
    showToast("Pick at least one character type.");
    return;
  }

  const length = Number(lengthRange.value);
  const allChars = selections.join("");
  const passwordChars = [];

  selections.forEach((group) => {
    passwordChars.push(group[randomIndex(group.length)]);
  });

  while (passwordChars.length < length) {
    passwordChars.push(allChars[randomIndex(allChars.length)]);
  }

  for (let index = passwordChars.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [passwordChars[index], passwordChars[swapIndex]] = [passwordChars[swapIndex], passwordChars[index]];
  }

  const password = passwordChars.join("").slice(0, length);
  generatedPasswordInput.value = password;
  strengthText.textContent = `Strength: ${getStrengthLabel(password)}`;
}

function randomIndex(max) {
  const values = new Uint32Array(1);
  window.crypto.getRandomValues(values);
  return values[0] % max;
}

function getSearchScore(entry, query) {
  if (!query) {
    return 0;
  }

  const site = (entry.site || "").toLowerCase();
  const notes = (entry.notes || "").toLowerCase();

  if (site.includes(query)) {
    return 2;
  }

  if (notes.includes(query)) {
    return 1;
  }

  return -1;
}

function getStrengthLabel(password) {
  let score = 0;

  if (password.length >= 12) score += 1;
  if (password.length >= 18) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 2) return "Fair";
  if (score <= 4) return "Strong";
  return "Very Strong";
}

function renderEntries() {
  const query = searchInput.value.trim().toLowerCase();
  const filteredEntries = entries
    .map((entry) => ({
      entry,
      searchScore: getSearchScore(entry, query),
    }))
    .filter(({ searchScore }) => searchScore >= 0)
    .sort((left, right) => {
      if (left.entry.pinned !== right.entry.pinned) {
        return Number(right.entry.pinned) - Number(left.entry.pinned);
      }

      if (left.searchScore !== right.searchScore) {
        return right.searchScore - left.searchScore;
      }

      return new Date(right.entry.updatedAt).getTime() - new Date(left.entry.updatedAt).getTime();
    });

  entryCount.textContent = String(entries.length);

  if (!filteredEntries.length) {
    entryList.innerHTML = `
      <div class="empty-state">
        <h3>No passwords found</h3>
        <p>Save a new password or adjust your search to see entries here.</p>
      </div>
    `;
    return;
  }

  entryList.innerHTML = filteredEntries
    .map(({ entry }) => {
      const maskedPassword = "\u2022".repeat(Math.max(entry.password.length, 8));
      return `
        <article class="entry-card">
          <div class="entry-header">
            <div>
              <div class="entry-title-row">
                <h3>${escapeHtml(entry.site)}</h3>
                ${entry.pinned ? '<span class="pin-badge">Pinned</span>' : ""}
              </div>
              <p class="entry-date">Saved ${new Date(entry.updatedAt).toLocaleString()}</p>
            </div>
          </div>
          <div class="entry-meta">
            <p>${escapeHtml(entry.account)}</p>
          </div>
          <div class="password-row">
            <p class="entry-password" id="password-${entry.id}">${maskedPassword}</p>
          </div>
          ${entry.notes ? `<p class="entry-notes">${escapeHtml(entry.notes)}</p>` : ""}
          <div class="entry-toolbar">
            <button type="button" class="inline-button" data-action="pin" data-id="${entry.id}">${entry.pinned ? "Unpin" : "Pin"}</button>
            <button type="button" class="inline-button" data-action="edit" data-id="${entry.id}">Edit</button>
            <button type="button" class="inline-button danger" data-action="delete" data-id="${entry.id}">Delete</button>
            <button type="button" class="inline-button" data-action="copy-account" data-id="${entry.id}">Copy Username</button>
            <button type="button" class="inline-button" data-action="reveal" data-id="${entry.id}">Reveal</button>
            <button type="button" class="inline-button" data-action="copy" data-id="${entry.id}">Copy Password</button>
          </div>
        </article>
      `;
    })
    .join("");
}

async function upsertEntry(event) {
  event.preventDefault();

  const entry = {
    id: entryIdInput.value || String(Date.now()),
    site: siteNameInput.value.trim(),
    account: accountNameInput.value.trim(),
    password: passwordValueInput.value,
    notes: notesInput.value.trim(),
    pinned: false,
    updatedAt: new Date().toISOString(),
  };

  if (!entry.site || !entry.account || !entry.password) {
    showToast("Website, username, and password are required.");
    return;
  }

  const existingIndex = entries.findIndex((savedEntry) => savedEntry.id === entry.id);

  if (existingIndex >= 0) {
    entry.pinned = entries[existingIndex].pinned;
    entries[existingIndex] = entry;
    showToast("Password updated.");
  } else {
    entries.unshift(entry);
    showToast("Password saved.");
  }

  await persistVault();
  resetForm();
  renderEntries();
}

function startEdit(id) {
  const entry = entries.find((savedEntry) => savedEntry.id === id);
  if (!entry) return;

  entryIdInput.value = entry.id;
  siteNameInput.value = entry.site;
  accountNameInput.value = entry.account;
  passwordValueInput.value = entry.password;
  notesInput.value = entry.notes || "";
  formTitle.textContent = "Edit password";
  saveBtn.textContent = "Update Password";
  cancelEditBtn.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteEntry(id) {
  entries = entries.filter((entry) => entry.id !== id);
  await persistVault();
  renderEntries();

  if (entryIdInput.value === id) {
    resetForm();
  }

  showToast("Password deleted.");
}

async function togglePinned(id) {
  entries = entries.map((entry) => (
    entry.id === id
      ? { ...entry, pinned: !entry.pinned, updatedAt: new Date().toISOString() }
      : entry
  ));

  await persistVault();
  renderEntries();
  showToast("Pinned status updated.");
}

function handleEntryAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;
  const entry = entries.find((savedEntry) => savedEntry.id === id);
  if (!entry) return;

  if (action === "edit") startEdit(id);
  if (action === "pin") {
    togglePinned(id).catch((error) => {
      console.error(error);
      showToast("Could not update the vault file.");
    });
  }
  if (action === "delete") {
    deleteEntry(id).catch((error) => {
      console.error(error);
      showToast("Could not update the vault file.");
    });
  }
  if (action === "copy-account") copyText(entry.account, "Username or email copied.");
  if (action === "copy") copyText(entry.password, "Password copied.");
  if (action === "reveal") {
    const passwordNode = document.getElementById(`password-${id}`);
    const revealed = passwordNode.dataset.revealed === "true";
    passwordNode.textContent = revealed ? "\u2022".repeat(Math.max(entry.password.length, 8)) : entry.password;
    passwordNode.dataset.revealed = String(!revealed);
    button.textContent = revealed ? "Reveal" : "Hide";
  }
}

function resetForm() {
  form.reset();
  entryIdInput.value = "";
  passwordValueInput.type = "password";
  togglePasswordBtn.textContent = "Show";
  formTitle.textContent = "Save a password";
  saveBtn.textContent = "Save Password";
  cancelEditBtn.classList.add("hidden");
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch (error) {
    const fallbackInput = document.createElement("textarea");
    fallbackInput.value = text;
    fallbackInput.setAttribute("readonly", "");
    fallbackInput.style.position = "absolute";
    fallbackInput.style.left = "-9999px";
    document.body.appendChild(fallbackInput);
    fallbackInput.select();

    try {
      document.execCommand("copy");
      showToast(successMessage);
    } catch (fallbackError) {
      console.error("Copy failed", error, fallbackError);
      showToast("Copy was blocked by the browser.");
    } finally {
      fallbackInput.remove();
    }
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderUpdateState() {
  updateStatusText.textContent = updateState.message;

  if (!window.desktopAPI) {
    updateActionBtn.textContent = "Desktop Only";
    updateActionBtn.disabled = true;
    return;
  }

  updateActionBtn.disabled = false;

  if (updateState.status === "available") {
    updateActionBtn.textContent = "Download Update";
    return;
  }

  if (updateState.status === "downloading") {
    updateActionBtn.textContent = "Downloading...";
    updateActionBtn.disabled = true;
    return;
  }

  if (updateState.status === "downloaded") {
    updateActionBtn.textContent = "Restart to Install";
    return;
  }

  updateActionBtn.textContent = "Check for Updates";
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      current += character;
      if (inQuotes && nextCharacter === '"') {
        current += nextCharacter;
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      if (current.trim()) {
        rows.push(parseCsvLine(current));
      }

      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim()) {
    rows.push(parseCsvLine(current));
  }

  return rows;
}

function findColumnIndex(headers, candidates) {
  const normalizedHeaders = headers.map((header) => header.trim().toLowerCase());
  return normalizedHeaders.findIndex((header) => candidates.includes(header));
}

function getGooglePasswordRows(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0];
  const websiteIndex = findColumnIndex(headers, ["name", "website", "origin", "url"]);
  const urlIndex = findColumnIndex(headers, ["url", "website", "origin"]);
  const usernameIndex = findColumnIndex(headers, ["username", "user name", "email"]);
  const passwordIndex = findColumnIndex(headers, ["password"]);
  const noteIndex = findColumnIndex(headers, ["note", "notes"]);

  if (usernameIndex < 0 || passwordIndex < 0 || (websiteIndex < 0 && urlIndex < 0)) {
    throw new Error("Unsupported Google Password Manager CSV format.");
  }

  return rows.slice(1).map((row) => ({
    site: row[websiteIndex] || row[urlIndex] || "",
    account: row[usernameIndex] || "",
    password: row[passwordIndex] || "",
    notes: noteIndex >= 0 ? row[noteIndex] || "" : "",
    url: urlIndex >= 0 ? row[urlIndex] || "" : "",
  }));
}

function createImportedEntry(importedRow) {
  const siteLabel = importedRow.site || importedRow.url || "Imported Login";
  const noteParts = [];

  if (importedRow.notes) {
    noteParts.push(importedRow.notes);
  }

  if (importedRow.url && importedRow.url !== importedRow.site) {
    noteParts.push(`Source URL: ${importedRow.url}`);
  }

  return {
    id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    site: siteLabel,
    account: importedRow.account,
    password: importedRow.password,
    notes: noteParts.join("\n"),
    pinned: false,
    updatedAt: new Date().toISOString(),
  };
}

function isDuplicateEntry(candidate) {
  return entries.some((entry) => (
    entry.site === candidate.site &&
    entry.account === candidate.account &&
    entry.password === candidate.password
  ));
}

async function importGooglePasswords(file) {
  if (!sessionKey || !vaultTarget) {
    showToast("Unlock your vault before importing Google passwords.");
    return;
  }

  if (!file) {
    return;
  }

  try {
    const csvText = await file.text();
    const importedRows = getGooglePasswordRows(csvText);

    if (!importedRows.length) {
      showToast("No passwords were found in that Google export.");
      return;
    }

    const newEntries = importedRows
      .filter((row) => row.account && row.password && (row.site || row.url))
      .map(createImportedEntry)
      .filter((entry) => !isDuplicateEntry(entry));

    if (!newEntries.length) {
      showToast("All imported Google passwords already exist in your vault.");
      return;
    }

    entries = [...newEntries, ...entries];
    await persistVault();
    renderEntries();
    showToast(`Imported ${newEntries.length} Google password${newEntries.length === 1 ? "" : "s"}.`);
  } catch (error) {
    console.error(error);
    showToast("Could not import the Google Password Manager CSV.");
  } finally {
    importGoogleInput.value = "";
  }
}

async function exportBackup() {
  if (!vaultMetadata) {
    showToast("Unlock a vault before exporting a backup.");
    return;
  }

  const backupContents = JSON.stringify(vaultMetadata, null, 2);
  const backupName = `${(vaultTarget?.name || "pocketvault").replace(/\.vault$/i, "")}-backup.vault`;

  if (window.desktopAPI) {
    const result = await window.desktopAPI.saveVaultFile(backupName);
    if (result?.canceled || !result?.filePath) {
      return;
    }

    await window.desktopAPI.writeVaultFile(result.filePath, backupContents);
  } else {
    const blob = new Blob([backupContents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = backupName;
    link.click();
    URL.revokeObjectURL(url);
  }

  showToast("Encrypted backup exported.");
}

async function importBackupFile(file) {
  if (!sessionKey || !vaultTarget) {
    showToast("Unlock your vault before importing a backup.");
    return;
  }

  if (!file) {
    return;
  }

  try {
    const raw = await file.text();
    const parsed = JSON.parse(raw);

    if (!parsed?.salt || !parsed?.vault || !parsed?.verifier) {
      throw new Error("Invalid backup file.");
    }

    const verifier = await decryptText(sessionKey, parsed.verifier);
    if (verifier !== "vault-check") {
      throw new Error("Backup uses a different master password.");
    }

    const decryptedVault = await decryptText(sessionKey, parsed.vault);
    entries = normalizeEntries(JSON.parse(decryptedVault));
    vaultMetadata = {
      ...parsed,
      updatedAt: new Date().toISOString(),
    };
    await writeVaultFile(vaultMetadata);
    renderEntries();
    resetForm();
    showToast("Backup imported into the current vault.");
  } catch (error) {
    console.error(error);
    showToast("Could not import that backup file.");
  } finally {
    importBackupInput.value = "";
  }
}

async function handleSetup(event) {
  event.preventDefault();

  if (!vaultTarget) {
    showToast("Choose a vault file first.");
    return;
  }

  const masterPassword = setupPasswordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (masterPassword.length < 8) {
    showToast("Use at least 8 characters for the master password.");
    return;
  }

  if (masterPassword !== confirmPassword) {
    showToast("Master passwords do not match.");
    return;
  }

  try {
    await createVaultFile(masterPassword);
    setupForm.reset();
    migrationNote.classList.add("hidden");
    showApp();
    renderEntries();
    showToast("Encrypted vault file created.");
  } catch (error) {
    console.error(error);
    showToast("Could not create the encrypted vault file.");
  }
}

async function handleUnlock(event) {
  event.preventDefault();

  try {
    vaultMetadata = await readVaultFile();
    await unlockVault(unlockPasswordInput.value);
    unlockForm.reset();
    showApp();
    renderEntries();
    showToast("Vault unlocked.");
  } catch (error) {
    console.error(error);
    showToast("Could not unlock that vault file.");
  }
}

function initializeApp() {
  if (!supportsVaultFiles()) {
    fileSupportWarning.classList.remove("hidden");
    createVaultFileBtn.disabled = true;
    openVaultFileBtn.disabled = true;
    return;
  }

  const legacyEntries = loadLegacyEntries();
  if (legacyEntries.length) {
    migrationNote.classList.remove("hidden");
  }

  const savedAutoLockMinutes = localStorage.getItem(AUTO_LOCK_STORAGE_KEY);
  if (savedAutoLockMinutes !== null) {
    autoLockSelect.value = savedAutoLockMinutes;
  } else {
    autoLockSelect.value = "3";
  }

  showAuthHome();
  const savedVaultTarget = loadPersistedVaultTarget();
  if (savedVaultTarget?.filePath) {
    vaultTarget = savedVaultTarget;
    updateSelectedFileUi();
    readVaultFile()
      .then((metadata) => {
        vaultMetadata = metadata;
        showUnlockForCurrentVault();
      })
      .catch((error) => {
        console.error(error);
        vaultTarget = null;
        vaultMetadata = null;
        clearPersistedVaultTarget();
        updateSelectedFileUi();
        showAuthHome();
      });
  }

  lengthValue.textContent = lengthRange.value;
  generatePassword();
  renderEntries();
  renderUpdateState();

  if (window.desktopAPI?.onUpdateStatus) {
    window.desktopAPI.onUpdateStatus((payload) => {
      updateState = payload;
      renderUpdateState();
    });
  }
}

lengthRange.addEventListener("input", () => {
  lengthValue.textContent = lengthRange.value;
});

autoLockSelect.addEventListener("change", () => {
  localStorage.setItem(AUTO_LOCK_STORAGE_KEY, autoLockSelect.value);
  resetAutoLockTimer();
  const minutes = getAutoLockMinutes();
  showToast(minutes > 0 ? `Auto-lock set to ${minutes} minute${minutes === 1 ? "" : "s"}.` : "Auto-lock disabled.");
});

registerActivityTracking();

createVaultFileBtn.addEventListener("click", () => {
  pickNewVaultFile().catch((error) => {
    if (error?.name !== "AbortError") {
      console.error(error);
      showToast("Could not create a new vault file.");
    }
  });
});

openVaultFileBtn.addEventListener("click", () => {
  pickExistingVaultFile().catch((error) => {
    if (error?.name !== "AbortError") {
      console.error(error);
      showToast("Could not open a vault file.");
    }
  });
});

generateBtn.addEventListener("click", generatePassword);
copyGeneratedBtn.addEventListener("click", () => {
  if (!generatedPasswordInput.value) {
    generatePassword();
  }

  if (generatedPasswordInput.value) {
    copyText(generatedPasswordInput.value, "Generated password copied.");
  }
});
useGeneratedBtn.addEventListener("click", () => {
  if (!generatedPasswordInput.value) {
    generatePassword();
  }

  if (generatedPasswordInput.value) {
    passwordValueInput.value = generatedPasswordInput.value;
    showToast("Generated password added to the form.");
  }
});
togglePasswordBtn.addEventListener("click", () => {
  const isHidden = passwordValueInput.type === "password";
  passwordValueInput.type = isHidden ? "text" : "password";
  togglePasswordBtn.textContent = isHidden ? "Hide" : "Show";
});
clearFormBtn.addEventListener("click", resetForm);
cancelEditBtn.addEventListener("click", resetForm);
form.addEventListener("submit", (event) => {
  upsertEntry(event).catch((error) => {
    console.error(error);
    showToast("Could not update the vault file.");
  });
});
searchInput.addEventListener("input", renderEntries);
entryList.addEventListener("click", handleEntryAction);
setupForm.addEventListener("submit", (event) => {
  handleSetup(event);
});
unlockForm.addEventListener("submit", (event) => {
  handleUnlock(event);
});
lockVaultBtn.addEventListener("click", lockVault);
importGoogleBtn.addEventListener("click", () => {
  importGoogleInput.click();
});
exportBackupBtn.addEventListener("click", () => {
  exportBackup().catch((error) => {
    console.error(error);
    showToast("Could not export the backup.");
  });
});
importBackupBtn.addEventListener("click", () => {
  importBackupInput.click();
});
importBackupInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  importBackupFile(file);
});
importGoogleInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  importGooglePasswords(file);
});
updateActionBtn.addEventListener("click", () => {
  if (!window.desktopAPI) {
    return;
  }

  if (updateState.status === "available") {
    window.desktopAPI.downloadUpdate();
    return;
  }

  if (updateState.status === "downloaded") {
    window.desktopAPI.installUpdate();
    return;
  }

  window.desktopAPI.checkForUpdates();
});

initializeApp();
