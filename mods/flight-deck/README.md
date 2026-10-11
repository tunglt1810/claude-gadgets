# flight-deck

A mod for Claude Code. It draws a band above the prompt. The band shows the tokens, the tool calls, the model working time, the cost and the prompt-cache countdown of the session. It has a pane that shows each subagent, its transcript, the content of the context window and each cache break.

The full description is in the [README of the repository](https://github.com/tunglt1810/claude-gadgets#readme).

## Install

Type this line at the prompt of Claude Code in a terminal:

```text
/plugin install flight-deck --marketplace tunglt1810/claude-gadgets
```

Answer `y` to add the marketplace, select a scope, then run `/reload-plugins`. A mod that you install at the user scope loads in Claude Desktop too.

## What the mod does on your machine

The mod sends no data to a server of its own. It has no network call and it starts no process.

### Tools that the mod calls

- `TaskStop`, for one subagent, on the second press of the `■ stop` button of that subagent. The first press only asks.
- The mod calls no other tool. It does not call a shell tool, an agent tool or an MCP tool.

### Data that the mod sends

- A message to a subagent of the session (`$.session.send`). It is only the text that you type in a message field of the pane, and it goes when you press Enter. The engine does its permission check for the message.
- The full count of the context screen (`$.session.usage`): the mod asks the engine for the count. The engine then sends token-count requests to the API that the session uses. The mod does not see the credential of the session.

### Data that the mod reads

- The token usage, the cost and the rate limits of the session.
- The messages of the session and of its subagents, to draw a transcript in the pane.
- The list of the subagents and the list of the tools.
- The settings of Claude Code, for two values: the lifetime of the prompt cache and the advisor model.
- Five environment variables, by their fixed names: `CLAUDE_CODE_DISABLE_1M_CONTEXT`, `CLAUDE_CODE_PROMPT_CACHE_TTL`, `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`, `ENABLE_PROMPT_CACHING_1H`, `FORCE_PROMPT_CACHING_5M`. None of them is a credential.

The mod draws this data on your screen. It keeps the counts of a session and the list of its subagents, with the description of each, in its store file. The store file is on your machine: `plugins/store/flight-deck_*.json` in the configuration directory of Claude Code. The store does not hold the text of a message.

### Hooks

- The mod has no hook on a permission check. It does not change a verdict of the engine, the permission mode or a permission rule.
- The hooks on `tool.call` and `agent.spawn` pass the event on with no change (`next(e)`). They read the result to count the tool calls, the changed lines and the subagents.
- The hooks on `turn.step`, `turn.start`, `turn.complete`, `session.compact`, `session.measure`, `prompt.compose`, `prompt.context`, `tool.describe` and `prompt.submit` pass the event on with no change. They read the result for the counts and for the cause of a cache break.

## License

MIT
