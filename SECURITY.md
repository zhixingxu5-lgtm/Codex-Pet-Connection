# Security Policy

## Supported versions

Only the latest GitHub Release receives security fixes during the MVP period.

## Reporting a vulnerability

Do not publish device tokens, pairing codes, credentials or exploit details in a public issue. Use
the repository owner's private security contact or GitHub private vulnerability reporting. Include
the affected version, platform, reproduction steps and impact.

## Security boundaries

- Device tokens are 32 random bytes, hashed on the server and stored in OS credential storage.
- Pairing codes are short-lived and rate-limited; they are stored only as hashes.
- Codex content is filtered locally and rejected by strict wire schemas.
- App Server access is read-only; Hooks communicate through user-local IPC plus a random secret.
- Production PostgreSQL must remain on a private network behind Caddy HTTPS/WSS.
