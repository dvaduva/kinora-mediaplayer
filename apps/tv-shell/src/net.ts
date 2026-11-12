/**
 * XMLHttpRequest instead of fetch: TV browsers as old as Chromium 53 (webOS 4) and 56 (Tizen 4) have no
 * AbortController, and the subnet scan needs a hard timeout on every probe.
 */
export type Response = { status: number; body: unknown };

export function request(
  method: "GET" | "POST",
  url: string,
  options: { token?: string | null; body?: unknown; timeout?: number } = {},
): Promise<Response> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = options.timeout ?? 5000;
    if (options.token) xhr.setRequestHeader("Authorization", `Bearer ${options.token}`);
    if (options.body !== undefined) xhr.setRequestHeader("Content-Type", "application/json");
    // Status 0 covers refused, unreachable, timed out and blocked by CORS: all "no Kinora here".
    const fail = () => resolve({ status: 0, body: null });
    xhr.onerror = fail;
    xhr.ontimeout = fail;
    xhr.onabort = fail;
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      resolve({ status: xhr.status, body });
    };
    try {
      xhr.send(options.body === undefined ? null : JSON.stringify(options.body));
    } catch {
      fail();
    }
  });
}
