export function normalizeLoginId(value: string): string {
  const id = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) {
    throw new Error(
      "ログインIDは32文字以内の半角英数字・ハイフン・アンダースコアで入力してください。先頭は英数字です。",
    );
  }
  return id;
}
export function loginEmail(value: string): string {
  return `${normalizeLoginId(value)}@example.com`;
}
export function normalizePropertyNumber(value: string): string {
  const number = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(number)) {
    throw new Error(
      "物件番号は64文字以内の半角英数字・ハイフン・アンダースコアで入力してください。先頭は英数字です。",
    );
  }
  return number;
}

export function jwtIssuedAt(token: string): number {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const value = JSON.parse(
      atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")),
    ).iat;
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}
