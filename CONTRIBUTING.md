# Contributing to Chiku

Thank you for helping improve Chiku. Contributions should be focused, source-grounded, and safe to review.

## Development setup

Chiku currently supports local development with Bun 1.x. From a clean checkout:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run format:ci
bun test
bun run build
bun run security:check
```

The package smoke test additionally exercises a packed tarball in a temporary installation directory:

```bash
bun run package:check
bun run package:test
```

`package:test` may require registry access to install package dependencies. Do not substitute a passing local build for that clean-install check.

## Making a change

1. Create a focused branch from `main`.
2. Inspect the existing permission, session, provider, and tool boundaries before changing them.
3. Keep security-sensitive behavior fail-closed and preserve user data.
4. Add deterministic tests for changed behavior, including failure cases.
5. Update documentation when commands or supported behavior change.
6. Run the relevant checks above and include the actual results in the pull request.

Do not include API keys, session files, private source code, or diagnostic data containing secrets in commits or issue reports.

## Pull requests

Describe the problem, the design decision, affected files, tests executed, limitations, and any compatibility or security impact. Maintainers make the final review, merge, and release decisions; automation does not approve or merge contributions.

## Scope and licensing

Chiku is distributed under the [MIT License](LICENSE). Preserve existing copyright and license notices in contributions and dependencies. This project does not require a contributor license agreement at this time.
