const LEGACY_STORAGE_KEY = "vault-password-manager-entries";
const ITERATIONS = 250000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const authOverlay = document.getElementById("authOverlay");
const appShell = document.getElementById("appShell");
const authTitle = document.getElementById("authTitle");
const authDescription = document.getElementById("authDescription");
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

async function pickNewVaultFile() {
  if (window.desktopAPI) {
    const result = await window.desktopAPI.saveVaultFile();
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
      suggestedName: "password-manager.vault",
    });

    vaultTarget = {
      type: "browser",
      handle,
      name: handle.name,
    };
  }

  vaultMetadata = null;
  updateSelectedFileUi();
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
    setupForm.classList.add("hidden");
    unlockForm.classList.remove("hidden");
    authTitle.textContent = "Unlock your vault";
    authDescription.textContent = "Enter your master password to decrypt this vault file.";
  } catch (error) {
    console.error(error);
    showToast("That file is not a valid vault file.");
    vaultTarget = null;
    vaultMetadata = null;
    updateSelectedFileUi();
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
  const importedEntries = await migrateLegacyEntriesIntoFile();
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
  entries = JSON.parse(decryptedVault);
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
  sessionKey = null;
  entries = [];
  resetForm();
  unlockForm.reset();
  searchInput.value = "";
  renderEntries();
  showAuthHome();
  showToast("Vault locked.");
}

function showAuthHome() {
  authOverlay.classList.remove("hidden");
  appShell.classList.add("app-hidden");
  appShell.setAttribute("aria-hidden", "true");
  setupForm.classList.add("hidden");
  unlockForm.classList.add("hidden");
  authTitle.textContent = "Choose your vault file";
  authDescription.textContent = "Create a permanent encrypted vault file on disk, then place it in OneDrive, Google Drive, Dropbox, or another sync folder for cross-device access.";
}

function showApp() {
  authOverlay.classList.add("hidden");
  appShell.classList.remove("app-hidden");
  appShell.setAttribute("aria-hidden", "false");
  updateSelectedFileUi();
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
  const filteredEntries = entries.filter((entry) => {
    const combinedText = `${entry.site} ${entry.account} ${entry.notes}`.toLowerCase();
    return combinedText.includes(query);
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
    .map((entry) => {
      const maskedPassword = "\u2022".repeat(Math.max(entry.password.length, 8));
      return `
        <article class="entry-card">
          <div class="entry-header">
            <div>
              <h3>${escapeHtml(entry.site)}</h3>
              <p class="entry-date">Saved ${new Date(entry.updatedAt).toLocaleString()}</p>
            </div>
            <div class="entry-actions">
              <button type="button" class="inline-button" data-action="edit" data-id="${entry.id}">Edit</button>
              <button type="button" class="inline-button danger" data-action="delete" data-id="${entry.id}">Delete</button>
            </div>
          </div>
          <div class="entry-meta">
            <p>${escapeHtml(entry.account)}</p>
          </div>
          <div class="password-row">
            <p class="entry-password" id="password-${entry.id}">${maskedPassword}</p>
            <div class="entry-actions">
              <button type="button" class="inline-button" data-action="reveal" data-id="${entry.id}">Reveal</button>
              <button type="button" class="inline-button" data-action="copy" data-id="${entry.id}">Copy</button>
            </div>
          </div>
          ${entry.notes ? `<p class="entry-notes">${escapeHtml(entry.notes)}</p>` : ""}
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
    updatedAt: new Date().toISOString(),
  };

  if (!entry.site || !entry.account || !entry.password) {
    showToast("Website, username, and password are required.");
    return;
  }

  const existingIndex = entries.findIndex((savedEntry) => savedEntry.id === entry.id);

  if (existingIndex >= 0) {
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

function handleEntryAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;
  const entry = entries.find((savedEntry) => savedEntry.id === id);
  if (!entry) return;

  if (action === "edit") startEdit(id);
  if (action === "delete") {
    deleteEntry(id).catch((error) => {
      console.error(error);
      showToast("Could not update the vault file.");
    });
  }
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

  showAuthHome();
  lengthValue.textContent = lengthRange.value;
  generatePassword();
  renderEntries();
}

lengthRange.addEventListener("input", () => {
  lengthValue.textContent = lengthRange.value;
});

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

initializeApp();
