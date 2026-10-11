// Test HTTP helper.
//
// Binds the real Express app to an ephemeral port and talks to it over actual HTTP with
// Node's built-in fetch. This exercises the full stack — JSON body parsing, the raw-body
// hook used for webhook verification, the error handler — which an in-process request
// stub would bypass. It also keeps the project free of a test-only HTTP dependency.

import app from "../../backend/src/server.js";

/** Starts the app on a free port. Returns a client bound to that origin. */
export async function startTestServer() {
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, "127.0.0.1");
    s.once("listening", () => resolve(s));
    s.once("error", reject);
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  /**
   * @returns {Promise<{status:number, body:any, headers:Headers}>}
   */
  async function call(method, path, { body, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, body: parsed, headers: response.headers };
  }

  return {
    baseUrl,
    get: (path, options) => call("GET", path, options),
    post: (path, body, options) => call("POST", path, { body, ...options }),
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
