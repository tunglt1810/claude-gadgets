# phi-guard: design spec

Status: TODO. This spec is a draft. The user did not approve it. No implementation plan exists, and no code exists.

The open decisions of section 11 come first. Do not write a plan before the user answers them.

## 1. Goal

The user develops software that reads DICOM images and shows them in a viewer. The user also analyzes data from those images. Real patient data is on the same computer.

The mod decreases the risk that Claude Code sends patient data to a wrong place by accident. A wrong place is the model, an external service, or a git repository.

The mod is a second layer. Section 12 gives the first layer, which needs no code.

## 2. Scope

In scope for version 0.1.0:

- Text of a tool result that contains PHI. The mod masks the PHI before the model reads the result.
- Text of a prompt that contains PHI. The mod stops the prompt.
- An outbound call that names a DICOM file or a data root. The mod denies the call.
- A status line that shows that the mod is active.

Out of scope for version 0.1.0:

- A bare value: a patient name or ID with no tag name near it. Section 13 gives the plan for it.
- Text in the pixels of an image.
- A commit that the user makes without Claude Code.
- A script that sends data from its own code. The mod reads the command line, not the script.
- An attacker. The mod prevents accidents. It does not stop a person or a model that tries to hide data.
- Compliance with a regulation. The mod gives no guarantee.

## 3. Terms

| Term | Meaning |
|---|---|
| PHI | Data that identifies a patient: a value of a tag of section 5.1, or a path in a data root. |
| data root | A directory that the user names in the configuration. It contains real patient data. |
| tag | A DICOM data element, with a keyword (`PatientName`) and a number (`(0010,0010)`). |
| span | One range of characters in a text that the detector marks as PHI. |
| mask | To replace a span with a label, for example `[PatientName]`. |
| outbound call | A tool call that can send data out of the computer or into git. Section 6.3 gives the list. |
| bare value | A PHI value in a text that has no tag keyword, tag number or column name near it. |

## 4. Leak paths

Claude Code has no tool that reads DICOM. It gets DICOM data through other tools.

| # | Path | Example | Event | 0.1.0 |
|---|---|---|---|---|
| 1 | A dump tool in Bash | `dcmdump a.dcm`, `pydicom.dcmread` | `tool.call` | yes |
| 2 | The code of the user in Bash | A test or script prints a dataset | `tool.call` | tagged values only |
| 3 | A raw dump in Bash | `strings`, `xxd` | `tool.call` | no (bare values) |
| 4 | A derived file | `Read` or `Grep` on a CSV, JSON or log file | `tool.call` | tagged values only |
| 5 | A file name or directory name | `ls` shows `NGUYEN_VAN_A/` | `tool.call` | data roots only |
| 6 | A prompt | The user pastes a header | `prompt.submit` | yes |
| 7 | An `@file` mention | The engine injects the file | `prompt.attachment` | no |
| 8 | A `!` command | `! dcmdump a.dcm` | not known | no |
| 9 | A background Bash command | Output arrives later | not known | no |
| 10 | An image | A PNG of a slice, a screenshot of the viewer | `tool.call` | no |
| 11 | An external service | `curl`, `scp`, an MCP tool, `WebFetch` | `tool.check` | yes |
| 12 | Git | `git add a.dcm` | `tool.check` | named paths only |
| 13 | A copy into the repository | `cp real.dcm tests/fixtures/` | `tool.check` | no |
| 14 | A memory or document file | Claude writes PHI into a spec | `tool.check` | no |

## 5. Detection

The detector is one pure function. It gets a text and the configuration. It returns the spans.

```ts
type Span = { start: number; end: number; label: string }
function detect(text: string, config: Config): Span[]
```

### 5.1 Tags

Version 0.1.0 knows these tags:

| Keyword | Number |
|---|---|
| `PatientName` | `(0010,0010)` |
| `PatientID` | `(0010,0020)` |
| `PatientBirthDate` | `(0010,0030)` |
| `OtherPatientIDs` | `(0010,1000)` |
| `OtherPatientNames` | `(0010,1001)` |
| `PatientAddress` | `(0010,1040)` |
| `PatientTelephoneNumbers` | `(0010,2154)` |
| `AccessionNumber` | `(0008,0050)` |
| `InstitutionName` | `(0008,0080)` |
| `ReferringPhysicianName` | `(0008,0090)` |

The label of a span is the keyword in brackets.

### 5.2 Text shapes

The detector finds the value of a tag in these shapes:

| Shape | Example | Span |
|---|---|---|
| `dcmdump` line | `(0010,0010) PN [DOE^JOHN]  # 8, 1 PatientName` | The text in the brackets. |
| pydicom line | `(0010, 0010) Patient's Name  PN: 'DOE^JOHN'` | The text in the quotes. |
| Key and value | `"PatientName": "DOE^JOHN"`, `PatientName=DOE^JOHN` | The value. |
| DICOM JSON | `"00100010": {"vr":"PN","Value":[...]}` | Each string in `Value`. |
| CSV column | A header line has `PatientName` as a column name | That column in each line below the header. |

A keyword matches with or without a space, an apostrophe or an underscore. Thus `Patient's Name`, `patient_name` and `PatientName` are the same keyword. Case has no effect.

An empty value gives no span.

### 5.3 Paths

A path that is in a data root is a span. Its label is `[data-root path]`.

The detector compares a path with the roots after it resolves `~` and removes a final `/`. It does not resolve a symbolic link.

## 6. Hooks

### 6.1 `tool.call`: mask a result

1. The hook calls `next(e)`. The tool runs.
2. The hook finds each string in the result, at any depth.
3. The hook replaces each span in each string with its label.
4. The hook returns the result with the same shape.

The hook does not change a value that is not a string. The engine compares the result with the output schema of the tool.

The tool ran before the hook masks the result. The hook protects the context of the model. It does not undo an effect of the tool.

### 6.2 `prompt.submit`: stop a prompt

When the text of a prompt has a span, the hook returns `{ drop: reason }`. The prompt does not go to the model.

The reason names the labels and their counts. It does not contain a value.

The hook does not mask a prompt. The user wrote the text, and a silent change can hide a mistake.

### 6.3 `tool.check`: deny an outbound call

A call is an outbound call when one of these conditions is true:

- The tool is Bash, and the command starts one of these programs: `git add`, `git commit`, `git push`, `curl`, `wget`, `scp`, `sftp`, `rsync`, `nc`, `aws`, `gsutil`, `gh`.
- The name of the tool starts with `mcp__`.
- The tool is `WebFetch` or `WebSearch`.

The hook denies an outbound call when its input, as JSON, has one of these:

- A span of section 5.
- A path that ends in `.dcm` or `.dicom`. Case has no effect.

The reason names the cause. It does not contain a value.

The hook calls `next(e)` first and changes only an `allow` or an `ask`. A `deny` from below stays.

### 6.4 Failure

The engine skips a hook that fails. A guard thus fails open.

Each of the three hooks has a `.catch` that refuses:

| Event | Answer of `.catch` |
|---|---|
| `tool.call` | `{ deny }`. The model gets no result. |
| `prompt.submit` | `{ drop }` |
| `tool.check` | `{ decision: "deny" }` |

## 7. Configuration

The configuration has one field in version 0.1.0:

```json
{ "dataRoots": ["~/data/patients", "/Volumes/pacs-export"] }
```

Section 11 has the open decision about the location of this file.

With no configuration, the detector uses only the tags of section 5.1. The status line shows `no data root`.

## 8. Status line

The mod draws one status item. It has no pane.

- `PHI guard` when the mod is active.
- `PHI guard 12` after the mod masked or refused 12 times in the session.
- `PHI guard: no data root` when the configuration names no root.

The status item never shows a value. Read `docs/design-system.md` before the implementation.

The mod keys its count by `$.session.id()`.

## 9. Layout

```
mods/phi-guard/
  hooks/register.tsx     the events and the status item
  src/tags.ts            the table of section 5.1
  src/detect.ts          detect(text, config)
  src/mask.ts            mask each string of a result
  src/outbound.ts        the conditions of section 6.3
  src/*.test.ts
```

`hooks/register.tsx` has no logic. Each file in `src/` is a pure module.

## 10. Tests

Each test uses values that are not real.

- `detect`: one test for each shape of section 5.2, for a keyword and for a number.
- `detect`: an empty value, a text with no PHI, two spans in one line.
- `detect`: a path in a data root, a path next to a data root (`~/data/patients-anon`).
- `mask`: a nested result keeps its shape. A number stays a number.
- `outbound`: each program of section 6.3. A command that is not outbound (`git status`, `ls a.dcm`).
- Hooks, with `claude-code/testing`: a masked Bash result, a dropped prompt, a denied `git add a.dcm`.
- Hooks: a detector that throws gives a refusal at each of the three events.

## 11. Open decisions (TODO)

The user must answer these before a plan.

1. **Version 0.1.0 or more.** The user said that the full design is complex and did not approve the small scope of section 2.
2. **Bare values.** Version 0.1.0 does not find a patient name in a log line. Section 13.1 finds it, at the cost of a DICOM header reader. Decide if 0.1.0 has a use without it.
3. **Location of the configuration.** Possible locations: a file in the project (`.claude/phi-guard.json`), or the plugin store. A file in the project is easy to read and to change.
4. **`git add .` and `git commit -a`.** The command names no file, so section 6.3 does not deny it. A fix: run `git status --porcelain` and examine the paths.
5. **Images.** Three rules are possible. The first is no rule. The second denies `Read` of an image in a data root. The third denies `Read` of each image that a command made from a DICOM file.
6. **Anonymized data.** Decide if Claude Code can do its work on anonymized copies only. If yes, section 12 becomes the primary control and the mod can stay small.
7. **Name.** `phi-guard` is a proposal.

## 12. First layer, without the mod

A content scan can miss a value. A permission rule cannot.

Add `deny` rules for each data root to the `settings.json` of the DICOM project. Claude Code then cannot read the files, and no scan is necessary for them.

This layer does not protect a derived file that is not in a data root. The mod protects that.

## 13. Later versions

### 13.1 Known values

1. The mod reads the header of each DICOM file in the data roots.
2. It keeps the values of the tags of section 5.1 in memory.
3. The detector finds each of these values in a text, with or without a tag name.

Problems to solve:

- The set of values is PHI. The mod must not write it to `$.store`, to a log or to the screen.
- One name has many forms: `NGUYEN^VAN^A`, `Nguyen Van A`, `Nguyễn Văn A`. A date has many formats.
- A short value, for example the ID `123`, matches text that is not PHI.
- One value must get one label (`[Patient#1]`) so that the model can relate two files of one patient.
- Sample data needs an allow list (`PHANTOM`, `Anonymous`).

### 13.2 Other items

- A git pre-commit hook that uses the same detector, for a commit without Claude Code.
- `prompt.attachment` for an `@file` mention.
- More tags: `StudyDescription`, `ImageComments`, private tags, dates, UIDs.
- Notebook output, browser screenshots, structured reports, PDF in a DICOM file.

## 14. Checks in a live session (open)

The typings of Claude Code 2.1.293 do not answer these. Check each one before the plan depends on it.

- The result of `Read` on a binary `.dcm` file.
- The event that carries the output of a `!` command.
- The output of a background Bash command: in the `tool.call` result, or in a later message.
- A tool call of a subagent raises `tool.call` and `tool.check` for the mod.
- The transcript on disk keeps the masked result, not the raw result.
- The position of the mod in the hook chain when the engine loads a second mod. A hook below the mod reads the raw result.
- The time that a scan of a large result takes, compared with the budget of a hook.

## 15. Known limits

- The mod finds only what section 5 describes. A value in a different shape goes to the model.
- A CSV file that Claude Code reads from the middle has no header line. The detector then finds no column.
- A tool that ran, ran. The mask does not undo an upload that the tool made.
- Without `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS`, the mod is not active and nothing shows that.
- The model API is itself a destination. The agreement between the user's organization and the API provider is not a subject of this mod.
