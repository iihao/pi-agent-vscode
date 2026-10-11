# Privacy

Pi Agent for VS Code is a local front-end. **It has no server, no account, no
telemetry, and no analytics.** Nothing about you or your code is sent to the
extension authors.

## What the extension does

- It launches the **pi** CLI you installed on your machine and talks to it over
  a local RPC channel (stdin/stdout). It does not make network requests itself.
- It reads your `~/.pi` configuration (models, sessions, skills, prompts) only
  through pi, and stores **no API keys**.
- It reads session files under pi's session directory to list your sessions.

## What leaves your machine

- **Model requests** are made by **pi**, directly from your machine to the
  provider **you** configured (e.g. Anthropic, OpenAI, a local model). Pi Agent
  is not a proxy and never sees or stores those requests.
- Your prompts, files, selections, images, and shell command output are sent to
  that provider by pi as part of normal operation, under the provider's terms.

## Links and remote content

- Links you click in chat are opened with your system browser, and only the
  `http`, `https`, and `mailto` schemes are allowed.
- Remote images in model output are **not** loaded automatically (they render as
  click-to-open links), so they cannot be used as tracking pixels.

## Trusted workspaces

pi can read/write workspace files and run shell commands, so the extension only
activates in **trusted** workspaces.

## Changes

This policy may be updated; see the repository history for changes.

## Contact

Questions or concerns: open an issue at
<https://github.com/iihao/pi-agent-vscode/issues>.
