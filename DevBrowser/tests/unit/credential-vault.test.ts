import { describe, it, expect, beforeEach } from 'vitest';
import { CredentialVault } from '../../src/main/crypto/vault';

describe('CredentialVault', () => {
  let vault: CredentialVault;

  beforeEach(() => {
    vault = new CredentialVault();
  });

  it('encrypts and decrypts secret using hardware or fallback mechanism', () => {
    const rawSecret = 'super_secret_jwt_token_12345';
    const encrypted = vault.encryptSecret(rawSecret);

    expect(encrypted).toBeTruthy();
    expect(encrypted).not.toBe(rawSecret);

    const decrypted = vault.decryptSecret(encrypted);
    expect(decrypted).toBe(rawSecret);
  });

  it('handles empty plaintext gracefully', () => {
    expect(vault.encryptSecret('')).toBe('');
    expect(vault.decryptSecret('')).toBe('');
  });

  it('clears in-memory secrets on wipe', () => {
    const secret = 'temp_api_key';
    const encrypted = vault.encryptSecret(secret);

    vault.clearAllSecrets();
    if (encrypted.startsWith('session_fallback:')) {
      expect(vault.decryptSecret(encrypted)).toBe('');
    }
  });
});
