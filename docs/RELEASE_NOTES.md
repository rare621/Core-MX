## Online request fixes and clearer paint installation

Install **MX-Bikes-Manager-Setup-1.0.6-x64.exe** on both riders' PCs.

**Update the online server too:** stop the server, replace **mxbm-server.js** in the existing server folder with the script from **mxbm-online-service.zip**, then restart **start-server.cmd**. Keep **mxbm-data.json** and **mxbm-files**. The health page should report `"version":3`. Accounts and shared files are preserved; the configured public address remains **http://67.84.130.214:60000**.

- Fixed an immediate friends retry loop after a failed request and repeated server-list requests triggered by sync progress. List requests share in-flight work and refresh at bounded intervals, with a longer pause after failures.
- Rate-limit responses now pause all client requests for the server's retry delay. Older servers without a delay get a one-minute pause. The app shows a useful retry message instead of “slow down.”
- Signed-in riders have separate server allowances, so friends behind one router do not consume each other's quota. The service still limits excessive requests and supplies `Retry-After`.
- Paint-only or model-dependent downloads now show a warning dialog before downloading. Cancel and Open model page do not start a download. Continue downloads for review rather than installing automatically. Files discovered to require a model after download also go through review and a warning before installation.
- Helmet/eye paints that contain a shared rider texture no longer get mistaken for rider kits or ask for a rider body. Ordinary stock rider kits use the default body automatically. Custom body selection appears only when needed; a missing body is explained instead of showing only incompatible choices.

Validation: 58 automated checks passed, including two clients sharing one isolated service, separate rate allowances, retry recovery, and repeated progress/error events. A hidden Electron check exercised warning cancellation, model links, download acceptance, the install warning, and the rider-body controls. Live friend-to-friend testing remains dependent on both updated apps and the running service.
