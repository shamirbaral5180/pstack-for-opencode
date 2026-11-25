# Parity gate

A contributor running the repository's own checks gets three guards: the vendored snapshot matches its manifest byte for byte, the translated content carries no Cursor-only text, and the 27 unit tests cover registration, sheet normalization, hooks, and agent permissions. These checks run without a server and fail loudly with a non-zero exit.

## Sub-features

- `gate-manifest` hashes all 1,980 vendored files against `vendor/MANIFEST.json` and checks the inventory counts.
- `gate-audit` scans registered bodies and every cached Markdown file for Cursor-only text.
- `gate-tests` runs `test/plugin.test.mjs` and `test/frontmatter.test.mjs` with `node --test`.

## How to get to it (user POV)

- Run `npm run check` before opening a pull request.
- Run a single gate when a failure points at one area, such as `npm run verify` after re-hashing vendor files.
- Read the parity record in `docs/parity.md` for the numbers the gates enforce.

## Driving it with harness.mjs

This feature does not use the server, so it needs no launch. Run these from the repository root.

- **Check the vendored snapshot.** Run `node scripts/verify.mjs`. It prints `ok: 1980 vendored files, 59 skills, 59 commands, 2 agents, root 65133c0e4de2f3e17682f49562f2b94b3489add3299388388c129269c1bacb30` and exits 0.
- **Check the translation.** Run `node scripts/audit-translation.mjs`. It prints `translation audit ok: registered bodies and 138 cached files clean` and exits 0.
- **Check the tests.** Run `node --test test/`. It prints `pass 27`, `fail 0`.
- **Check a failure mode.** Temporarily change one byte in a vendored file, run `node scripts/verify.mjs`, and confirm it exits 1 with `hash drift <path>`. Revert the byte before continuing.
- **Proof.** Keep the three stdout blocks. Record the exit code for each.

## Gotchas

- `npm` scripts are blocked in PowerShell on this machine, because `npm.ps1` runs under an execution policy that disallows scripts. Run the `node` entry points directly, as above, or call `npm.cmd`.
- `node scripts/verify.mjs` reports 59 commands while the running plugin registers 60: the `/loop` adapter command is added at delivery time and is not part of the vendored inventory.
- The tests use a mock plugin context. They prove the registration logic, not that OpenCode loads the plugin. Pair this gate with [registration](./registration.md) whenever the change touches the plugin entry, `src/index.js`, or `package.json`.
- The audit count moves when the cache is rebuilt, so compare the "clean" verdict, not the exact file count, across runs.
- Editing `vendor/pstack` without running `node scripts/hash-vendor.mjs` fails `verify` by design. That is the guard working, not a setup problem.
