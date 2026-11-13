/**
 * Saves a generated file (CSV, Excel, PDF) in a way that works everywhere.
 *
 * - In a browser: the usual download through a temporary link.
 * - In the Android app (Capacitor): the WebView ignores downloads of `blob:` links,
 *   so the file is written to the app's cache with @capacitor/filesystem and handed
 *   to Android's share sheet with @capacitor/share. From there the user saves it to
 *   Files or Drive, or opens it in Excel or a PDF viewer.
 */
import { Capacitor } from '@capacitor/core';

export type SaveResult = 'downloaded' | 'shared' | 'cancelled';

export const isNativeApp = () => Capacitor.isNativePlatform();

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    // result is "data:<mime>;base64,<data>"; Filesystem wants only the data part
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}

function browserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveFile(blob: Blob, filename: string): Promise<SaveResult> {
  if (!isNativeApp()) {
    browserDownload(blob, filename);
    return 'downloaded';
  }

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);

  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  });

  try {
    await Share.share({ title: filename, dialogTitle: 'Save or share the report', files: [uri] });
    return 'shared';
  } catch (err) {
    // Closing the share sheet without choosing an app rejects with "Share canceled"
    if (/cancel/i.test(String((err as Error)?.message ?? err))) return 'cancelled';
    throw err;
  }
}
