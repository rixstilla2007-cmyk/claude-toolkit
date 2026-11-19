---
name: openai-api-key
description: How to set the OPENAI_API_KEY environment variable safely on Windows (PowerShell, cmd), macOS and Linux, temporarily or permanently, and how to check it. Use when the user asks how to set, check or remove an OpenAI API key for a program or SDK.
---

# Setting OPENAI_API_KEY

Programs and the official OpenAI SDKs read the key from the `OPENAI_API_KEY`
environment variable, so it never has to be written into code.

## Rules

- Never ask the user to paste a real key into the chat. Give them the command
  with a placeholder (`sk-...`) to run themselves. In a cloud session, store the
  key through the environment's secure credential form, not in chat.
- Never commit a key to git. If a project keeps it in `.env`, make sure `.env`
  is in `.gitignore`.
- A variable set in one terminal does not reach another machine or container.

## Windows PowerShell

Current window only (gone once it is closed):

```powershell
$env:OPENAI_API_KEY = "sk-..."
```

Permanently for this user (open a new window afterwards):

```powershell
[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", "sk-...", "User")
```

Check that it is set without printing the key: `[bool]$env:OPENAI_API_KEY`

## Windows cmd

- Current window only: `set OPENAI_API_KEY=sk-...`
- Permanently: `setx OPENAI_API_KEY "sk-..."` (only new windows see it)

## macOS / Linux (bash, zsh)

- Current terminal only: `export OPENAI_API_KEY="sk-..."`
- Permanently: add that line to `~/.zshrc` (macOS) or `~/.bashrc` (Linux), then
  open a new terminal.
- Check that it is set: `[ -n "$OPENAI_API_KEY" ] && echo set || echo missing`

## Removing it

- PowerShell: `Remove-Item Env:OPENAI_API_KEY`, and for a permanent one also
  `[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", $null, "User")`
- bash/zsh: `unset OPENAI_API_KEY`, and delete the line from the rc file

If a key has ever been shown in a chat, a screenshot or a commit, revoke it in
the OpenAI dashboard and create a new one.
