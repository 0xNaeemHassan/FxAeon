# Release checklist

Use this checklist for a production release. It records review tasks, not the
current status of a deployment.

- [ ] Review the changed product behavior and ensure every protocol action is
  within [`../fx-scope.lock.json`](../fx-scope.lock.json).
- [ ] Run `pnpm verify`; review the dependency audit, secret scan, generated
  bundle, and browser reports.
- [ ] For changes to signing, protocol reads, position discovery, or recovery,
  run the relevant protected Anvil gate and inspect its redacted proof manifest.
- [ ] Confirm Preview and Production Pages variables, restricted provider
  origins/quotas, Privy app IDs, and Telegram settings are separate and
  correctly configured. Keep secrets out of every `NEXT_PUBLIC_*` variable.
- [ ] Review the production app and landing domains, headers, CSP, and published
  build. Follow [`deployment.md`](deployment.md).
- [ ] Test browser connection and transaction review. Separately verify native
  Telegram authentication, wallet handoff, and actual bridge delivery before
  claiming those flows have been tested end to end.
- [ ] Confirm the privacy disclosures and product risk wording match current
  data handling. The in-app privacy page is operational disclosure; it is not a
  complete legal policy or terms of service.

FxAeon is unaudited software for financial transactions. Release evidence and
automated checks do not certify protocol safety or replace an independent
security review.
