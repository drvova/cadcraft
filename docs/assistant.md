# The assistant

CADCraft has an assistant that works **in the drawing in front of you**: a conversation pane where a
model asks for tools, and the tools are CADCraft's own commands. It is not a chatbot beside a CAD
program — when the assistant draws, the objects appear in the drawing you are looking at, and every
change is an ordinary command you could have typed.

## Open it

- **Window ▸ Assistant** (⌘7 / Ctrl+7), or the pane's own close button to hide it again.
- Type `assistant` at the command line, or run it with parameters:

```json
{"id": 1, "method": "engine.execute", "params": {"command": "assistant", "params": {"ask": "offset every closed outline on layer Walls 2 mm outward"}}}
```

| `assistant {…}` | does |
|---|---|
| `{}` | show the pane |
| `{"ask": "…"}` | show the pane and ask the model |
| `{"stop": true}` | stop the turn running now |
| `{"clear": true}` | forget the conversation |
| `{"open": false}` | do the above without opening the pane |

## Set the provider

The assistant speaks the **OpenAI chat protocol**, which is what OpenAI, OpenRouter, Anthropic's
compatibility endpoint, DeepSeek, Groq, Mistral, xAI, Together, Ollama, LM Studio, vLLM and
llama.cpp all serve. A provider is three things: a base URL, a model name and a key.

Set it in the pane's own settings (the fold at the top) or in the Options JSON form:

```json
{"id": 1, "method": "engine.execute", "params": {"command": "options", "params": {
  "assistantBaseUrl": "http://127.0.0.1:11434/v1",
  "assistantModel": "qwen3-coder",
  "assistantApiKey": "",
  "assistantMaxTokens": 8192
}}}
```

`options {}` reports `assistantPreset`, `assistantBaseUrl`, `assistantModel`, `assistantMaxTokens`
and `assistantKeySet` (never the key itself). The pane's presets are convenience, not a limit: type
any OpenAI-compatible base URL. A local server usually wants no key at all.

The provider is saved with the machine's CADCraft profile (the same place the interface preferences
live), so it survives restarts. The key is stored in that profile in clear text — it is your
machine's profile, and a key that cannot be read cannot be used, but do not paste a key you would
not leave in a local file.

**The browser build has no assistant yet.** The pane needs a worker thread and a socket; the web
build says so instead of pretending. Everything else about the pane (the tool catalog, the
conversation) is ordinary Rust and compiles for the web.

## What the model can do

The catalog is the **same one the MCP server publishes** — one list, two faces
(`crates/ai/src/surface.rs`). Every entry names a control method or a command:

| Tool | Command behind it |
|---|---|
| `command_line {text}` | `cmdline.input` — a line typed exactly like a person's |
| `script {text}` | `cmdline.script` |
| `execute {command, params}` | `engine.execute` — any command with JSON parameters |
| `list_commands {filter?}` | `engine.commands` |
| `inspect_drawing {…}` | `drawing.inspect` |
| `query_entities {…}` | the `entities` command |
| `find_text {…}` | the `texts` command |
| `describe_drawing {…}` | the `describe` command — the measured report |
| `bench_sheet {…}` | the `techsheet` command — stones, carats, metal weight |
| `attach_image {…}`, `trace_image {…}` | `imageattach`, `imagetrace` |
| `new_drawing`, `open`, `save`, `cancel` | the file commands and Escape |

Because the surface is shared, a command added to the engine is reachable from the pane, from an
external MCP client and from a script on the same day, with the same parameters and the same
results. `list_commands` is how the model finds them: the pane's brief tells it never to guess a
command id or a parameter name.

`render`, `screenshot`, `ui_inspect` and `ui_click` are **not** in the pane's catalog: they belong
to a client that needs a picture of the window, and a base64 PNG in a text transcript helps no
model. An external MCP client still has them.

## How a turn works

1. The pane briefs the model: the application and version, the drawing's name, its units, how many
   objects the active space holds, how many are selected, and the extents. The brief is fresh every
   turn, so the model always knows what is in front of you.
2. The model answers; the text streams into the pane as it arrives.
3. Every tool call it makes is sent to the **interface thread**, which runs it through
   `control::handle` — the same dispatcher the JSON control channel and the MCP bridge use — and
   sends the result back. The worker never touches the drawing.
4. The results go back to the model, which either asks for more tools or answers in words. The loop
   stops after 12 rounds without an answer, and says so.
5. The transcript keeps the conversation for the session; `Clear` forgets it. Nothing is written to
   the drawing that you could not undo (Ctrl+Z), because every tool call is a command, and commands
   are undoable.

Stop cancels the turn: no further rounds and no further tool calls. A tool call already running
finishes, because a command must not be abandoned half-way through a change.

## What the model is told to report

A drawing report is a report of measurements, and the brief says so: the model is told to state the
numbers the tools returned (objects, handles, layers, lengths, areas, weights), to name anything
that came out different from what was asked and why, and to give the one thing worth checking. The
`describe_drawing` tool exists for exactly this: it is the measured report of a drawing or a
selection — counts, extents, per-layer usage, drawn length, enclosed areas, open contours, texts,
block and raster references, degenerate objects, optional gap/junction analysis of loose chains,
and a plain-language narrative. A model asked "what is in this drawing?" reaches for it and quotes
what it says, instead of guessing from a picture.

## Why it is built this way

- **One surface.** The model can do exactly what an MCP client can do — no private back door, no
  second implementation of "move these objects" to keep in step with the engine. A bug in a tool is
  a bug in a command, and it is fixed once.
- **The interface thread owns the drawing.** Tool calls arrive as control requests and are answered
  between frames, exactly like a `cmdline.input` from a script. There is no locking around the
  session and no way for a model to change a drawing while a command is mid-prompt.
- **Streamed, not polled.** The answer arrives word by word, so a slow model is visibly working
  rather than apparently hung.
- **The transcript is the model's view.** The pane shows what the model was told, tool results
  included. When something goes wrong, the conversation in front of you is the evidence.

## Where the code lives

| | |
|---|---|
| `crates/ai/src/surface.rs` | the tool catalog, its schemas, and dispatch to the control harness |
| `crates/ai/src/chat.rs` | the conversation, the OpenAI wire form, and the request budget |
| `crates/ai/src/client.rs` | the transport: one `/chat/completions` endpoint, streamed |
| `crates/ai/src/agent.rs` | the turn loop: ask, run tools, feed results back, repeat |
| `crates/ui-egui/src/assistant.rs` | the pane, the worker, and the bridge to the control harness |
| `crates/mcp/src/tools.rs` | the same catalog, wrapped in MCP's protocol |

The tests are worth reading: `crates/ai/src/tests.rs` runs a whole turn against a real HTTP server
on localhost that answers like a provider — request shape, streamed deltas, tool round-trip and
transcript included — so the loop is proven end to end without a model.
