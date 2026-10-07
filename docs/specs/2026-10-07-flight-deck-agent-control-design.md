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
| An allow rule for `SendMessage` | The message goes through in auto mode. Tested with `--allowedTools SendMessage`. |
| A `tool.check` hook in auto mode | The engine calls the hook for a message that the same plugin sends from another hook, and `next.origin.plugin` is the name of that plugin. For a call that the closure of an element makes (`onSubmit`, `onPress`), the engine runs no hook of the plugin: a first spike and a live session showed that. The engine's verdict for the call is `ask`. A hook that answers `allow` lets the message through with no rule. A hook that answers `ask` changes nothing, and no `PermissionRequest` event comes (tested headless). |

A stop in the middle of a Bash call gave this order: the stop result, the end of the Bash call (`isError`, exit code 137) 7 ms later, then `turn.complete` (`aborted`) 3 ms after that. A stop in the middle of a step gave the end of the step 2 ms before `turn.complete`. The hooks of the mod are async, so the end of a call can finish its work after the end of the run. For that reason an agent is marked as running at the start of a step or a call, not at its end.

Not tested: a message to a killed agent, an allow rule in a settings file, and the `Input` element on a live desktop.

## 3. Behavior

### 3.1 Control row

An open agent row has a control row below its detail row.

- `» message` opens a message field below the control row, with the focus in it. The mod moves the focus two times: at the press, and 80 ms later, because the pressed button stays on the screen. A second press closes the field.
- `■ stop` is there only while the agent runs. The first press changes the label to `■ stop?`. The second press stops the agent. A press on any other button takes the question back, and so does the end of the agent.
- A row with less than 25 cells draws the two buttons as `»` and `■` (`■?` for the question).

### 3.2 Message field

- Enter sends the text. An empty text is not sent.
- After a sent message, the field of the tree closes. The field of the transcript screen stays, empty.
- When the engine does not send the message, the field keeps the text, and a red row below it gives the reason: `not sent: <first line of the reason>`.
- When the reason says that the classifier gave no verdict, the row is the button `allow messages in auto mode`. The text stays in the field.
- A press of the button stores the answer (`allowSend` in the store of the mod, for all sessions) and sends the text of the field.
- After the answer, a `tool.check` hook changes the verdict `ask` to `allow` for a message of the pane only: a call that the mod made (`next.origin.plugin` is `flight-deck`; the model's call has `engine`), from the main loop, to an agent that has a message of the pane on its way. A `deny` stays. An `ask` that has a `rule`, a `hook` or a `ceiling` stays too: a person or an organization gave it. A SendMessage call of the model keeps the verdict of the engine.
- The message goes from a `ui.input` hook (a submit of the field) and the button from a `ui.press` hook, not from the closures of the elements: the `tool.check` hook of the mod runs only for a call that a hook of the mod makes.
- With no text in the field, a press of the button does nothing and stores no answer.
- The terminal draws a focused field in as many rows as its text needs. The text wraps at a space, in rows of the width of the box less 9 cells (the label and the `⏎ send` hint). The header of a transcript keeps that many rows for the field, and the rule and the transcript start below them. The mod counts the rows (`fieldLayout`): the engine gives no height of an Input.
- When the first row of the text fills its width, the terminal draws the whole field in one row, cut with `…`. The label of the field then grows by a cell (`››:`), which moves the place where the text wraps. Padding around the field does not have this effect. A first word that is longer than a row stays cut.
- A field without the focus is one row, cut with `…`. The header keeps the rows of the focused field then, and the rows below the field are empty.
- With the answer and still no verdict, the row is `not sent: add "SendMessage" to permissions.allow`.
- The mod cannot read the permission mode of the session. The hook thus changes each `ask` that the mode alone gave. In default mode the engine gave `allow` for a message of a plugin (tested), so the hook changed nothing there.
- The hook compares `input.to` of the call with the id of the agent. The engine gave the id for an agent with no name (tested). An agent with a name is not tested: if the engine gives the name, the verdict stays `ask` and the row names the rule of the settings.
- The pane has no control that takes the answer back. To take it back, delete `allowSend` from the store file of the mod.
- A message that goes from the transcript screen is the last row of the transcript, and the field is in the header. The pane thus moves its window to the end (`$.ui.scroll({ in, to: 'end' })`) after the send, and one time more at the end of the next run of the agent. A move of the window by the person, another screen, or a stop of the agent cancels the second move. The test driver does not raise an event for this call: a live session in a pty showed the two moves, with the field below the bar and the focus in it.
- The mod does not change the permission mode and adds no rule.
- A second Enter while a message is on its way sends nothing. The field is empty during that time, and the text comes back when the engine refuses the message.

### 3.2.1 Refused stop

- When the engine does not stop the agent, a red row below the controls gives the reason: `not stopped: <first line of the reason>`.
- A stop of the pane is not a tool call of the session: the `calls` count does not change.

### 3.3 Transcript screen

- The toolbar has the `» message` button, and the `■ stop` button while the agent runs, with the same two presses. The bar of a scrolled transcript has a second row with the two buttons, with the keys `sticky:msg:<id>` and `sticky:stop:<id>`.
- `» message` opens the message field as the last row of the header, with the focus in it. A second press closes it. The field stays open after a sent message.
- A reason of a refused message or stop is a row below the field.
- While the transcript is scrolled, the field and the reason are below the two rows of the bar. The terminal draws the cursor of a field that is out of the window at the last row of the screen, so the field stays in the window.
- The terminal draws the field in one box out of the flow. Its `top` is the row of the header, or the row below the bar. The box keeps its place in the tree at each scroll, so the field keeps its focus. The header keeps empty rows for the box.
- A desktop scrolls by the pixel and has no bar: the field is in the flow of the header.
- The two buttons of the toolbar are icons when the pane has less than 51 columns. The two buttons of the bar are icons when it has less than 25.

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
- Only a step starts a run of an agent. A tool call marks no agent: a call of a stopped step can start after the end of the run.
- A `completed` notification of the engine ends an agent in its first run only. For an agent that a message started again, the notification can be of the earlier run, and nothing in it names the run. So it changes no agent that runs again. When the mod does not see the `turn.complete` of such a run (a hot reload in the middle of the run), the agent shows as running until the session loads again. This is a known limit, not a defect to fix.
- The runs of an entry that an older version stored are not counted again: such an entry is one run at least, and an agent that an older version stored in a later run shows one run less. This is a known limit.
- While the window moves to a new row, the bar is drawn at the two rows and the message field at the new row only: a field has one place in a drawing. This is a known limit.
- The row of the message field in the header is a count of the header's rows (`headRows` in `pane.tsx`): a new header row must be added to it.
