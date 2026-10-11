# Privacy policy of flight-deck

Date: 2026-10-11.

`flight-deck` is a mod that runs in Claude Code on your machine.

## Data that the author gets

None. The mod has no server. It sends no data to the author or to a third party. It has no analytics and no telemetry.

## Data that the mod reads

The mod reads data of your Claude Code session to draw it on your screen:

- the token usage, the cost and the rate limits of the session,
- the messages of the session and of its subagents,
- the list of the subagents and the list of the tools,
- two values of the settings of Claude Code: the lifetime of the prompt cache and the advisor model,
- five environment variables that set the prompt cache and the context window. None of them is a credential.

## Data that the mod keeps

The mod keeps the counts of a session and the list of its subagents in a store file on your machine. The file is `plugins/store/flight-deck_*.json` in the configuration directory of Claude Code. The file holds the 50 most recent sessions at most. It does not hold the text of a message. To delete the data, delete the file.

## Data that leaves your machine

- A message that you type in the pane goes to a subagent of your session, through Claude Code.
- The full count of the context screen makes Claude Code send token-count requests to the API that your session uses.

The privacy policy of your API provider applies to these requests, as it does to the rest of your session.

## Changes

A change to this policy is a change to this file in the repository.

## Contact

Open an issue at <https://github.com/tunglt1810/claude-gadgets/issues>.
