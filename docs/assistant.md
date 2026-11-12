# The assistant: one tool, and the model builds its own

CADCraft gives a model **one tool**: `run`, which executes **AutoLISP inside the open drawing**.
Everything else — drawing, reading back, measuring, rendering, exporting — is reached from code,
as a function call in that namespace. There is no catalog of typed verbs to choose from, and no
glue to write when a command lands.

That is the whole design. A fixed menu of tools is the wrong interface for CAD: every install and
every command set differs, models differ in what they handle well, and each new capability would
need a hand-wired entry. Instead the model discovers what is there, writes helpers, and keeps
them.

## Open it

- **Window ▸ Assistant**, Ctrl+7 (⌘7 on macOS), or the assistant key at the end of the title bar.
  The same three close it. The chats outlive the panel: closing it hides them, it does not end
  them.
- **Ctrl+K** (⌘K), or Window ▸ Ask the Assistant…, opens one line over the top of the drawing.
  It holds the same draft as the panel's composer. Enter sends it and opens the panel, where the
  turn is read; Escape closes the line and gives the keyboard back to the drawing. What is
  selected goes with the message, and the line says how many objects that is.
- The first time, the composer itself is the way in: its model slot reads "Set up a model" and
  opens the setup sheet. So does Send: a message typed before setup is kept and sent once the
  setup is saved.

There is no `assistant` command today. The egui interface had one (`assistant {ask, attach,
stop, clear}`), and it was removed with that interface on 2026-11-11. A script or an MCP client
drives the drawing through `run` directly; it cannot open the panel or ask the model.

## The panel

The panel is laid out like an agent panel, not a chat. It is
`apps/ui/src/components/AssistantPane.tsx` over `assistant.ts` and `assistant-session.ts`.

- **Chats are tabs.** New chat opens one beside the others, and each closes on its own key. A
  chat is its own conversation, draft and running turn.
- **The transcript.** Your prompt sits in a quiet block and the model's words stand without a
  bubble, with headings, lists and code blocks drawn as such. A link opens only when its address
  is `http` or `https`; anything else the model writes as a link stays text. A Markdown table
  has no room in a narrow panel, so it is drawn as readable rows: the header as a small heading
  and each row as one line, its first cell in bold. Each tool call is one row that
  reads as a sentence, what ran and what changed, and opens to the code and the whole result. A
  failure is a calm block that says what happened and the way out. A long chat draws its newest
  rows and keeps following the end while you are there.
- **The composer.** It rests on one line and grows with the draft. Enter sends; Shift+Enter is
  a new line. A draft that starts with `/`
  searches the commands, and Enter runs the lit one as the command palette would. The selection
  on the canvas rides along as a chip. A context meter says how much the next request carries.
  A message too long to send is refused, never cut.
- **While a turn runs** the composer keeps taking input: a message sent then joins a queue,
  listed above the composer, and goes when the turn ends. A queued message can be dropped. Stop
  (or Escape) ends the turn, and the turn's status and Stop stay in view while the setup sheet is
  open. A queued message does not steer the running turn; the egui pane's
  "send now at the next tool call" has no counterpart yet.
- **Changes.** The panel records the drawing's undo depth before a request. When the model has
  changed the drawing, a row says how many changes there are and opens to one line per step.
  **Undo all** takes the drawing back to before them (the engine's `undoto`); **Keep** accepts
  them. The conversation stays either way.
- **Pictures.** Attach with the paperclip, paste, or drop: up to four per message, 4 MB each.
  The model sees them. In the interface a picture has no file path, so the model cannot trace or
  measure it with code (see below).
- The panel's left edge drags to resize (or the arrow keys; Home returns it), and the width is
  kept.

## Set the provider

The assistant speaks the **OpenAI chat protocol**, which is what OpenAI, OpenRouter, Anthropic's
compatibility endpoint, DeepSeek, Groq, Mistral, xAI, Together, Ollama, LM Studio, vLLM and
llama.cpp all serve. A provider is three things: a base URL, a model name and a key.

Setup is a sheet over the transcript, in two steps:

1. **Provider.** A list of presets, each marked "needs a key" or "no key", and "Other" for any
   OpenAI-compatible server. Choosing one fills in its address and model.
2. **Connection.** One form: the base URL, the API key where the provider needs one (the key
   that shows or hides it sits inside the field), the model, one status line, and three
   actions: Cancel, Check connection and Save. **Check connection** asks the server for its
   models and lists them to pick from, or says why it could not. **Save** says why it waits when
   something is missing.

The presets are a convenience, not a limit: type any OpenAI-compatible base URL. A local server
usually wants no key, and it must accept requests from the page's origin (`OLLAMA_ORIGINS` for
Ollama).

**Where the setup is kept.** In the browser's `localStorage`, under
`cadcraft.assistant.provider`, key included, in clear text. In the desktop app that storage is
the webview's own folder under the user's data directory. Treat the key as you would a key in a
local file.

**What protects the key.** It is sent only to the base URL, as a bearer token. An address that
carries a name and password is refused. The key is removed from any error text before it is
shown. A stored setup is read strictly: anything that is not a plain object of bounded strings
with an `http` or `https` address is read as "not set up", never half-read.

**What bounds a provider.** A reply, a tool call's name and arguments, the number of tool calls
in a reply, the model list and the whole stream each have a limit, a stream that goes silent is
ended, and a turn is capped at 12 rounds. The limits are constants at the top of
`apps/ui/src/assistant.ts`.

**What has been exercised.** The tests run whole turns against a local stand-in that answers
like a provider. No hosted provider has been run against this panel.

## What the interface changes

The interface runs the engine as WebAssembly, in a browser tab and in the desktop window alike.
That build has no file system, which changes three things the model is told about in its brief:

- A definition a run writes with `(defun …)` is kept for the session, live in the drawing's
  namespace and reported as kept, and is not reloaded next time.
- `(render)` answers that there is nowhere to write a PNG. The drawing is on screen.
- An attached picture has no path, so `imagetrace` and `imageattach` cannot reach it. The model
  can look at it and describe it.

Everything else behaves as over MCP: `(cmd …)`, `(cmdline …)`, `(commands)`, `(describe "id")`,
`(inspect)`, measurements. Kept definitions, renders and traced pictures work in full on a
native session: `cadcraft-cli mcp`.

## The namespace

The same vocabulary is seeded into every drawing's AutoLISP environment, so a person, a script, an
MCP client and the panel all drive the application through exactly the same functions.

| function | does |
|---|---|
| `(commands [filter])` | every command: id, label, aliases, parameters, whether it can run |
| `(cmd "id" params)` | run any command with parameters — the same call a script makes |
| `(cmdline "line" …)` | type lines at the command line like a person, in order |
| `(inspect)` | the drawing's summary (counts, extents, layers, blocks, selection, undo) |
| `(describe)` | the application and the open drawing in one call |
| `(describe "id")` | one command: label, aliases, parameters, example |
| `(describe x)` | a function's parameters, a list's keys, a value's type |
| `(render [path] [w h [x0 y0 x1 y1]])` | draw the drawing to a PNG and show it to the model |
| `(value "name")`, `(values)` | the named strings passed beside the code |
| `(kept)`, `(forget "name")` | the definitions kept across restarts |
| `(man)` | the manual |

```lisp
(cmd "line" '((POINTS . ((0 0) (10 0)))))          ; draw
(cmd "circle" '((CENTER . (0 0)) (RADIUS . 5)))
(cmdline "rectang" "0,0" "100,60")                  ; …or type at the command line
(cmd "entities" '((TYPE . "Circle") (LIMIT . 10)))  ; read back
(cmd "describe")                                    ; the measured report
(cmd "techsheet")                                   ; stones, carats, metal weight
(cmd "imagetrace" '((PATH . "wing.png") (WIDTH . 60)))
(render 1200 800)                                   ; look at it
```

`T` is true and `nil` is false in parameters; a parameter left out keeps the command's own default.
A command's real parameter names are in `(commands)` and `(describe "id")` — never guess one.

## Kept definitions: the model builds its own tooling

On a native session (`cadcraft-cli mcp`, `cadcraft-cli run`), a `defun` (or a `setq` of a
literal) is **saved** after the run that wrote it, one file per name in the definitions directory (`%APPDATA%\CADCraft\definitions`, `~/.config/cadcraft/definitions`, or
`CADCRAFT_DEFINITIONS` when set). At the start of a drawing's session they are loaded back, so a
helper written today is there tomorrow — in this process and in the next one:

```lisp
(defun wing-width () (cdr (assoc 'WIDTH (cmd "entities" '((TYPE . "Polyline"))))))
```

`(kept)` lists them; `(forget "name")` deletes one. A definition that cannot be loaded is reported
and skipped, so a broken file can never stop a session from starting. A definition may not replace
a built-in (`(defun CAR …)`): the language is put back and the run says `refused:`.

Only definitions are kept — never the work. A restart rebuilds the model's tools without replaying
anything that touched the drawing.

## What a run reports

`run` returns the last value of the code, the lines it printed, the definitions it kept, the
pictures it drew, and the error if it failed. The model reads that as **text**, not JSON:

```
drew 3 outlines
=> ((HANDLE . "10A") (HANDLE . "10B") (HANDLE . "10C"))
kept: WING-OUTLINE
rendered C:\Users\you\AppData\Local\Temp\cadcraft-render-4821-0.png
```

Pictures come back as image content blocks in MCP. The interface's panel has no renders to show
(see above).
The brief tells the model to quote the numbers the tools returned and to name anything that came
out different from what was asked: a drawing report is a report of measurements.

## The same tool over MCP

`cadcraft-cli mcp` serves the identical tool, one entry in `tools/list` with the same schema, on
a headless session:

```json
{"mcpServers": {"cadcraft": {"command": "cadcraft-cli", "args": ["mcp"]}}}
```

`cadcraft-cli mcp --connect HOST:PORT` bridges to a running app's control channel. The egui app
served that channel and the web interface does not yet, so today there is nothing to connect to
([control-protocol.md](control-protocol.md), [mcp.md](mcp.md)).

There are no resources and no second tool set: the drawing is read from code like everything else.

## Security is a deployment fact, not a toggle

**Running code is what this tool does.** It executes with the authority of the process it runs in,
on the user's own drawings — which is the point: the model works in the drawing in front of you,
and every change is an ordinary undoable command.

There is deliberately **no enable/disable flag and no code-free mode**. A flag would reframe the
interface as an optional feature layered on something else, which it is not. If the model driving
CADCraft is not trusted with the user's files, run CADCraft sandboxed — a container, a VM, a jail —
and that is the boundary.

## Why it is built this way

- **One surface, one door.** A tool call is `engine.execute` of the `run` command, which runs the
  same AutoLISP a person can type at the command line. A capability is a command, and a command
  added to the engine is reachable the same day — with no glue in the assistant, MCP or the panel.
- **Discovery is in-language.** `(commands)`, `(describe "id")` and `(man)` are functions the code
  calls, so a model explores the application the way it explores anything else: by asking.
- **The panel never touches the drawing itself.** A tool call is the facade's
  `execute("run", …)`, the same call a menu item makes, and the panel refreshes from the engine
  afterwards.
- **Adaptation is emergent.** Each deployment's model accretes its own helpers in its own
  definitions directory. There is no per-model tool set anywhere in the code.

## Where the code lives

| | |
|---|---|
| `crates/ai/src/code.rs` | the one tool: schema, argument checking, and the report a model reads |
| `crates/ai/src/surface.rs` | the catalog — one entry — and the `Harness` a call goes through |
| `crates/ai/src/agent.rs`, `chat.rs`, `client.rs` | the Rust turn loop, conversation and streamed transport. The egui pane ran them; no app does today. The interface's port is below |
| `crates/engine/src/lisp/agent.rs` | the namespace: the functions, the manual, kept definitions |
| `crates/engine/src/cmd/code.rs` | the `run` command (load, run, keep, report) |
| `crates/engine/src/paths.rs` | the config directory and the definitions directory |
| `crates/mcp/src/tools.rs` | the same tool, wrapped in MCP's protocol |
| `apps/ui/src/assistant.ts` | the interface's port: provider presets and checks, the wire protocol, the bounds, the brief, the transcript's text |
| `apps/ui/src/assistant-session.ts` | one chat: the conversation, the queue, the changes, the stored setup |
| `apps/ui/src/components/AssistantPane.tsx` | the panel and the setup sheet |

The tests are worth reading. `crates/mcp/src/tests.rs` drives the whole drafting workflow —
a plate with holes, entity queries, texts, the report, a traced picture — **through `run` and
nothing else**, which is what proves a capability is not lost by not being a tool.
`crates/ai/src/tests.rs` runs whole turns against a real HTTP server on localhost that answers
like a provider. `apps/ui/src/assistant.test.ts` and `assistant-session.test.ts` cover the
interface's port: the setup's faults, key redaction, a stored setup read strictly, the bounds on
a provider's output, the queue and the changes row.

## Revision history

| Date | Change | Summary |
|---|---|---|
| 2026-11-12 | minor | Ctrl+K opens a line over the drawing that shares the composer's draft and sends to the chat in front. The system prompt names the jewelry commands (`ringsizes`, `ring`, `gem`, `gemlist`, `setting`, `pave`, `gemfit`, `techsheet`) and asks for answers in finger sizes, millimetres, carats and grams, in the interface and in `crates/ai`. The empty panel's suggestions are jewelry requests |
| 2026-11-12 | minor | First run and setup as they are at 43dd130: the composer's "Set up a model" slot is the way in and a message typed before setup is sent after Save; step two is one form with one status line and Cancel, Check connection, Save; the composer rests on one line |
| 2026-11-11 | minor | Replies draw links (http and https only) and turn a Markdown table into readable rows; the turn's status and Stop stay in view while the setup sheet is open |
| 2026-11-11 | major | Rewritten for the web interface after the egui interface was removed: how to open the panel, the panel, setup in two steps with a connection check, where the key is kept and what protects it, the bounds on a provider, what the WebAssembly build changes. Removed: the `assistant {…}` command and the `options` assistant keys (both were the egui interface's), the `--connect` configuration as the default, `crates/ui-egui/src/assistant.rs` |
