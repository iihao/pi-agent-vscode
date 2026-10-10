# Security Policy

## Reporting a Vulnerability

Please **do not** open a public issue for security problems. Instead, report
privately via GitHub's
[Security Advisories](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities)
("Report a vulnerability" on the repository's **Security** tab).

Please include:

- a description of the issue and its impact,
- steps to reproduce,
- affected version(s) and environment (OS, VS Code version, pi version).

We aim to acknowledge reports within a few days.

## Scope and threat model

Pi Agent is a **front-end** for the local `pi` coding agent. Important
considerations:

- The extension **executes the locally installed `pi` CLI**, which can read and
  write files and run shell commands in the workspace. Treat it like any
  terminal-based coding agent.
- The extension **only activates in trusted workspaces**
  (`capabilities.untrustedWorkspaces.supported: false`).
- It **does not store API keys or model credentials**; those live in your local
  `~/.pi` configuration and are managed by `pi`.
- The webview runs under a strict Content-Security-Policy and communicates with
  the extension host only via `postMessage`. Model output is rendered with
  `markdown-it` (`html: false`) and escaped.

## Supported Versions

The latest published version receives security fixes.
