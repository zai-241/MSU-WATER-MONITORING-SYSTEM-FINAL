/**
 * @file email.ts
 * @description Login identifier handling, in one place (Q6).
 *
 * Operators may type either a full email address or a short username. A bare
 * username is expanded with the default account domain. This rule used to be
 * copy-pasted into the login form, the password-reset form and the Admin Panel.
 */

/** Domain appended when an operator signs in with a bare username. */
export const DEFAULT_ACCOUNT_DOMAIN = 'gmail.com';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Turns what the user typed into the email address the account is registered under. */
export function resolveLoginEmail(input: string): string {
  const trimmed = (input ?? '').trim();
  if (!trimmed || trimmed.includes('@')) return trimmed;
  return `${trimmed}@${DEFAULT_ACCOUNT_DOMAIN}`;
}

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}
