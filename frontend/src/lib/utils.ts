import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Message of anything thrown (Error, Firebase error, plain object); '' when there is none. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return '';
}

/** Firebase-style error code (e.g. "auth/invalid-email") of anything thrown, if it has one. */
export function errorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  return undefined;
}
