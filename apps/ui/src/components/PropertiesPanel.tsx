/**
 * The properties palette: the engine's `properties` rows over `properties.set`. The rows are
 * parsed by `../props` (the shell calls `parseProperties`); this component renders them and
 * commits an edit on blur/Enter as `onSet(buildPatch({ [key]: value }))`.
 *
 * No engine call lives here: the shell owns the facade, shows a notice for a refused set, and
 * refreshes the reply.
 */

import { createEffect, createSignal, For, Index, Show, type Accessor, type JSX } from "solid-js";
import { buildPatch, type PropRow, type PropertiesReply } from "../props";
import { SectionLabel } from "../ui/SectionLabel";
import "../interaction.css";

export interface PropertiesPanelProps {
  properties: PropertiesReply | null;
  selectionCount: number;
  layers: readonly string[];
  onSet: (patch: Record<string, unknown>) => void;
  onNotice?: (message: string) => void;
}

export function PropertiesPanel(props: PropertiesPanelProps): JSX.Element {
  const title = (): string => {
    const reply = props.properties;
    if (reply === null) return props.selectionCount > 0 ? `${props.selectionCount} selected` : "No selection";
    if (reply.kind === "defaults") return "No selection";
    return reply.count === 1 ? "1 object" : `${reply.count} objects`;
  };

  return (
    <aside class="properties">
      <div class="properties-head">
        <SectionLabel>Properties</SectionLabel>
        <span class="properties-state">{title()}</span>
      </div>
      <div class="properties-body" role="list">
        <Index each={props.properties?.rows ?? []}>
          {(row) => (
            <PropRowView row={row} layers={props.layers} onSet={props.onSet} onNotice={props.onNotice} />
          )}
        </Index>
        <Show when={(props.properties?.rows.length ?? 0) === 0}>
          <div class="properties-empty">No properties to show.</div>
        </Show>
      </div>
    </aside>
  );
}

interface PropRowViewProps {
  row: Accessor<PropRow>;
  layers: readonly string[];
  onSet: (patch: Record<string, unknown>) => void;
  onNotice?: (message: string) => void;
}

/** The options of a choice row: the caller's layer names win for the layer row, else the row's own. */
function optionsFor(row: PropRow, layers: readonly string[]): readonly string[] {
  if (row.key === "layer" && layers.length > 0) return layers;
  return row.choices ?? [];
}

function PropRowView(props: PropRowViewProps): JSX.Element {
  const [draft, setDraft] = createSignal(props.row().value);
  /** The text the last number warning was for, so Enter-then-blur does not warn twice. */
  let warned = "";
  // Re-seed when the engine's value changes (a refresh after a set), never while typing.
  createEffect(() => setDraft(props.row().value));

  /** Commit an edited value: nothing when it did not change, `onSet` otherwise. */
  const commit = (value: string): void => {
    if (value === props.row().value) return;
    props.onSet(buildPatch({ [props.row().key]: value }));
  };

  const commitText = (): void => {
    const row = props.row();
    const value = draft();
    if (row.kind === "number") {
      if (value.trim() === "") {
        setDraft(row.value);
        return;
      }
      if (!Number.isFinite(Number(value.trim()))) {
        if (warned !== value) {
          warned = value;
          props.onNotice?.(`${row.label} needs a number`);
        }
        return;
      }
    }
    warned = "";
    commit(value);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitText();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(props.row().value);
    }
  };

  const control = (): JSX.Element => {
    const row = props.row();
    if (!row.editable) {
      return (
        <span class="prop-readonly" title={row.value}>
          {row.value}
        </span>
      );
    }
    if (row.kind === "bool") {
      return (
        <input
          class="prop-check"
          type="checkbox"
          checked={draft() === "true"}
          aria-label={row.label}
          onChange={(e) => {
            const value = e.currentTarget.checked ? "true" : "false";
            setDraft(value);
            commit(value);
          }}
        />
      );
    }
    if (row.kind === "choice") {
      const options = optionsFor(row, props.layers);
      return (
        <select
          class="prop-select"
          value={draft()}
          aria-label={row.label}
          onChange={(e) => {
            const value = e.currentTarget.value;
            setDraft(value);
            commit(value);
          }}
        >
          <Show when={!options.includes(draft())}>
            <option value={draft()}>{draft()}</option>
          </Show>
          <For each={options}>{(option) => <option value={option}>{option}</option>}</For>
        </select>
      );
    }
    return (
      <input
        class="prop-input"
        type="text"
        inputmode={row.kind === "number" ? "decimal" : undefined}
        spellcheck={false}
        autocomplete="off"
        value={draft()}
        aria-label={row.label}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        onBlur={commitText}
      />
    );
  };

  return (
    <div class="prop-row" role="listitem">
      <span class="prop-label" title={props.row().label}>
        {props.row().label}
      </span>
      <span class="prop-value">{control()}</span>
    </div>
  );
}
