# Security policy

## Supported versions

The `main` branch is the actively maintained version. Older tags may not receive security fixes.

## Reporting a vulnerability

Please do not open a public issue for a suspected security vulnerability. Contact the project maintainers privately through the repository's configured security contact or GitHub Security Advisories.

Include:

- affected commit or version;
- browser and operating system;
- a minimal reproduction or proof of concept;
- impact and any suggested mitigation.

AperGlyph is local-first, but imported `.wdiag` files and downloaded assets are untrusted input. Report parser, SVG/PDF export, worker, service-worker, or dependency issues with the same care as application vulnerabilities.
