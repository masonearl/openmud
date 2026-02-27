# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x (current) | ✅ |

## Reporting a Vulnerability

If you discover a security vulnerability — especially anything involving API key exposure, injection in the chat API, or data leakage — please **do not open a public GitHub issue**.

Instead, email **hi@masonearl.com** with:
- A description of the vulnerability
- Steps to reproduce
- Potential impact

You'll receive a response within 48 hours. We'll work with you to understand, fix, and disclose the issue responsibly.

## Scope

This project is open-source and MIT-licensed. Key security considerations:

- **API keys**: Never committed to the repo. Always stored as environment variables. See `config/env.example`.
- **Chat API**: The `/api/chat` endpoint proxies to OpenAI/Anthropic. No user data is stored server-side.
- **Python tools**: Pure computation, no network calls, no file I/O, no database.
- **Calculators**: All client-side JavaScript. No data sent to any server.

## Out of Scope

- Issues in third-party dependencies (OpenAI SDK, Anthropic SDK) — report these upstream
- Theoretical attacks with no practical exploit path
- Issues requiring physical access to infrastructure
