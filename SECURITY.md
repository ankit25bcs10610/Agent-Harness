# Security policy

Please do not disclose a suspected vulnerability in a public issue, pull request, or discussion. Do not include credentials, private source, session files, or exploit details in public reports.

## Reporting

Use GitHub's private vulnerability reporting or Security Advisory flow for this repository when it is available. If that private channel is unavailable, open a minimal public issue requesting a private reporting channel without including sensitive details.

Reports should include only the minimum safe information needed to reproduce the problem:

- affected version or commit;
- operating system and runtime version;
- safe reproduction steps or a disposable fixture;
- impact description without secrets;
- whether the issue affects local CLI behavior, an optional integration, or packaging.

There is no guaranteed response time or supported hosted incident service. Do not assume that a report has been accepted, fixed, or disclosed until a maintainer confirms it through the private channel.

## Security boundaries

Chiku is a local terminal application. Shell execution, provider access, plugins, and repository content have different trust boundaries. The documented permission policy and release checks do not constitute an OS sandbox, formal certification, or a guarantee against malicious host environments.
