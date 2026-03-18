# IDHub browser-assisted auth

The IDHub tab now supports a browser-assisted sign-in flow so you do not need to paste the IDHub API URL, tenant ID, source ID, or bearer token manually.

How to use it:

1. Open the **IDHub** tab.
2. Paste a **RapidIdentity tenant URL** or a direct **IDHub tenant URL**.
3. Click **Connect**.
4. A separate Chrome / Chromium / Edge window opens.
5. Finish the RI / Okta / support-mode sign-in in that window.
6. If you land in the RapidIdentity portal after sign-in, click the **IDHub** tile once.
7. Return to Big Log, pick a source, and click **Load jobs**.

Notes:

- The app launches an isolated browser profile so it can safely capture the IDHub OAuth token after you complete the normal UI flow.
- Chrome, Chromium, or Edge must be installed locally.
- If your browser is installed in a non-standard location, set `BIGLOG_BROWSER_PATH` before starting the app.
- Refresh tokens are stored only in the running app process. Reconnect if you restart the server.
