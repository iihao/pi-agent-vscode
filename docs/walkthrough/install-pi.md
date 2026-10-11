## Install the pi CLI

Pi Agent is a front-end for the local **pi** agent. Install it once:

```bash
npm install -g @earendil-works/pi-coding-agent
```

Then run `pi` once in a terminal to log in and choose a model. Pi Agent reuses
that same `~/.pi` configuration — no API keys are stored in VS Code.

> If you use a custom install, set `pi-agent.pi.executable` to the `pi` path.
