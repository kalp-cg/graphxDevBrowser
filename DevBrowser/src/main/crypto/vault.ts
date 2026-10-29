import { safeStorage } from 'electron';

export class CredentialVault {
  private inMemoryFallback: Map<string, string> = new Map();

  public isAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  public encryptSecret(plaintext: string): string {
    if (!plaintext) return '';
    try {
      if (this.isAvailable()) {
        const encryptedBuffer = safeStorage.encryptString(plaintext);
        return encryptedBuffer.toString('base64');
      }
    } catch (e) {
      console.warn('[CredentialVault] Hardware encryption error, using fallback:', e);
    }
    // Session-only fallback
    const key = `fallback_${Date.now()}_${Math.random()}`;
    this.inMemoryFallback.set(key, plaintext);
    return `session_fallback:${key}`;
  }

  public decryptSecret(ciphertext: string): string {
    if (!ciphertext) return '';
    try {
      if (ciphertext.startsWith('session_fallback:')) {
        const key = ciphertext.replace('session_fallback:', '');
        return this.inMemoryFallback.get(key) || '';
      }

      if (this.isAvailable()) {
        const buffer = Buffer.from(ciphertext, 'base64');
        return safeStorage.decryptString(buffer);
      }
    } catch (e) {
      console.error('[CredentialVault] Decryption failed:', e);
    }
    return '';
  }

  public clearAllSecrets(): void {
    this.inMemoryFallback.clear();
  }
}
