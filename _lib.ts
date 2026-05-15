/**
 * _lib.ts
 * Shared helpers for the Makerkit credit API.
 */

export const DEFAULT_CREDITS = 10.00; // Default credits for new users

export function cleanEmail(email: any): string {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

/**
 * List of dev/owner emails that get unlimited credits.
 * These bypass balance checks for both Leadscrapper and Map2Web.
 */
export function isDevEmail(email: string): boolean {
  const devs: string[] = [
    'shreyashchandak.lx@gmail.com',
    'shriganeshkolhe@gmail.com',
  ];
  return devs.includes(email.toLowerCase());
}
