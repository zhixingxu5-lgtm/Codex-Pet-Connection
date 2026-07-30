# Contributing

Use Node.js 22, pnpm 11 and Rust stable. Create focused changes and do not commit credentials,
generated installers, databases, `node_modules`, `dist`, `target` or Pingu source material without a
clear MIT license.

Before opening a pull request run:

```bash
pnpm typecheck
pnpm test
pnpm build
cargo test --workspace
cargo check --workspace
```

Protocol changes require compatibility notes and tests. Any new Hook field must pass the privacy
allow-list; adding Prompt, reply, path, project or command content is not accepted.
