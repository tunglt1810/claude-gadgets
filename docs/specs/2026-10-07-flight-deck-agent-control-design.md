# flight-deck: message and stop an agent from the pane

Date: 2026-10-07. Tested on Claude Code 2.1.292.

## 1. Goal

The person sends a message to a subagent from the pane, and stops a subagent from the pane. The main loop does not spend a turn to pass the message on.

## 2. Spike results

The spike mod is `.tmp/spike-send/`. It ran headless.

| Question | Result |
| --- | --- |
| A message to a running agent | `$.session.send({ to: { agentId }, text })` answers `{ isDelivered: true }`. The agent reads the message at its next step, as a message of the coordinator, and obeys it. |
| A message to a completed agent | The engine starts the agent again under the same id. |
| The answer of the agent | The engine sends a `task-notification` to the main loop at the end of each run. The main loop runs one turn to read it. The mod appends nothing. |
| Stop | `$.tool.call({ tool: 'TaskStop', task_id: agentId })` stops the agent in each permission mode. The status becomes `killed`, and the main loop gets a notification. |
| Auto mode | The classifier gives no verdict for a message that a plugin sends: `{ isDelivered: false, reason }`. A second try gets the same answer. |
| A `tool.check` hook of the mod | The engine does not call it for the mod's own message. The mod cannot allow its own message. |
| An allow rule for `SendMessage` | The message goes through in auto mode. Tested with `--allowedTools SendMessage`. |

A stop in the middle of a Bash call gave this order: the stop result, the end of the Bash call (`isError`, exit code 137) 7 ms later, then `turn.complete` (`aborted`) 3 ms after that. A stop in the middle of a step gave the end of the step 2 ms before `turn.complete`. The hooks of the mod are async, so the end of a call can finish its work after the end of the run. For that reason an agent is marked as running at the start of a step or a call, not at its end.

Not tested: a message to a killed agent, an allow rule in a settings file, and the `Input` element on a live desktop.

## 3. Behavior

### 3.1 Control row

An open agent row has a control row below its detail row.

- `» message` opens a message field below the control row, with the focus in it. The mod moves the focus two times: at the press, and 80 ms later, because the pressed button stays on the screen. A second press closes the field.
- `■ stop` is there only while the agent runs. The first press changes the label to `■ stop?`. The second press stops the agent. A press on any other button takes the question back, and so does the end of the agent.
- A row with less than 24 cells draws the two buttons as `»` and `■` (`■?` for the question).

### 3.2 Message field

- Enter sends the text. An empty text is not sent.
- After a sent message, the field of the tree closes. The field of the transcript screen stays, empty.
- When the engine does not send the message, the field keeps the text, and a red row below it gives the reason: `not sent: <first line of the reason>`.
- When the reason names the classifier, the row is `not sent: add "SendMessage" to permissions.allow`.
- The mod does not change the permission mode and adds no rule.
- A second Enter while a message is on its way sends nothing. The field is empty during that time, and the text comes back when the engine refuses the message.

### 3.2.1 Refused stop

- When the engine does not stop the agent, a red row below the controls gives the reason: `not stopped: <first line of the reason>`.
- A stop of the pane is not a tool call of the session: the `calls` count does not change.

### 3.3 Transcript screen

- The toolbar has the `» message` button, and the `■ stop` button while the agent runs, with the same two presses. The bar of a scrolled transcript has the two buttons too, with the keys `sticky:msg:<id>` and `sticky:stop:<id>`.
- `» message` puts the focus in the message field. When the field is after the last item, the pane scrolls to it first. A field out of the window takes no focus: the keys then go to the prompt of the session.
- The bar has three rows: the back button, the agent and its context, then the two buttons, then the message field. A reason of a refused message or stop is a fourth row.
- On the terminal, the message field is in the bar while the transcript is scrolled, and after the last item when it is not. The terminal draws the cursor of a field that is out of the window at the last row of the screen, so the field stays in the window. A desktop has no bar: its field is after the last item.
- The two buttons of the toolbar are icons when the pane has less than 51 columns. The two buttons of the bar are icons when it has less than 25.
- The message field is after the last item of the transcript. The engine gives no height of the pane, so no row stays at the end of the pane.

## 4. Design

- `src/control.ts`: `controlLabels(room, isAsked)` and `sendFailure(reason)`.
- `PaneView` holds `compose` (the agent whose field is open on the tree), `stopAsk`, `controlError` and `sent`. A session change clears the first three.
- `PaneAction` has the kinds `compose`, `stop` and `send`. The keys are `msg:<id>`, `stop:<id>` and `say:<id>` (the field).
- The text that the person types is in a module variable of the hooks module, not in state: a write to state on each key draws the pane again.
- A surface with no `Input` element draws no field.

## 5. Limits

- A click presses a button of a pane that does not hold the keyboard, and the engine then refuses a focus move: `that site does not hold the keyboard`. The mod asks for the keyboard as it does when the pane opens (`$.ui.open` with `focus: true`), then moves the focus 80 ms and 320 ms later. A live log gave a refused move 11 ms after the request and a move that landed 80 ms after it.
- The surface gives the keyboard to the pane only while the prompt of the session is empty. With text in the prompt, the message field gets no focus and the keys go to the prompt. The person must click the field.

- Each answer of an agent, and each stop, costs one turn of the main loop. That is the notification of the engine.
- A Button takes no color: the stop button is not red.
