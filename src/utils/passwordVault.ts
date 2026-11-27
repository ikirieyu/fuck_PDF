/**
 * fuck_PDF — Password Vault
 * Stores successfully matched PDF passwords in localStorage so Stage 2
 * auto-unlock can re-use them without prompting the user again.
 *
 * Keys are stored with recency order (newest first, max 50 entries).
 * Passwords are stored in plain text — this is an intentional local-only
 * design decision: passwords never leave the device.
 *
 * localStorage keys:
 *   fuck_pdf_vault_keys   — JSON array of password strings (deduplicated)
 */

const VAULT_KEY = 'fuck_pdf_vault_keys';
const MAX_VAULT_SIZE = 50;

/** Returns the current vault entries, newest first. */
export function vaultGetAll(): string[] {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return [];
  }
}

/** Saves a successfully matched password into the vault (deduplicates, trims to MAX). */
export function vaultSave(password: string): void {
  if (!password) return;
  try {
    const existing = vaultGetAll().filter((p) => p !== password);
    const updated = [password, ...existing].slice(0, MAX_VAULT_SIZE);
    localStorage.setItem(VAULT_KEY, JSON.stringify(updated));
  } catch {
    // localStorage quota exceeded or unavailable — silently ignore
  }
}

/** Removes a specific password from the vault (call when a saved key fails on a new doc). */
export function vaultRemove(password: string): void {
  try {
    const updated = vaultGetAll().filter((p) => p !== password);
    localStorage.setItem(VAULT_KEY, JSON.stringify(updated));
  } catch {}
}

/** Clears the entire vault. */
export function vaultClear(): void {
  try {
    localStorage.removeItem(VAULT_KEY);
  } catch {}
}

/** Returns the number of saved passwords. */
export function vaultCount(): number {
  return vaultGetAll().length;
}
