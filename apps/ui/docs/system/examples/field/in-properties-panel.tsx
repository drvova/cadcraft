// Caption: A value row of the properties palette: commits on Enter and on leaving, Escape restores.
import { createSignal } from "solid-js";
import { Field } from "../../../../src/ui/Field";

export default function InPropertiesPanel() {
  const [radius, setRadius] = createSignal("12.5");
  const [draft, setDraft] = createSignal(radius());
  const [refused, setRefused] = createSignal(false);
  const commit = (leaving: boolean): void => {
    if (Number.isFinite(Number(draft())) && draft().trim() !== "") {
      setRadius(draft());
      setRefused(false);
    } else if (leaving) {
      setDraft(radius());
      setRefused(false);
    } else {
      setRefused(true);
    }
  };
  return (
    <div class="prop-row" role="listitem">
      <span class="prop-label">Radius</span>
      <span class="prop-value">
        <span class="prop-field">
          <Field
            variant="inline"
            size="sm"
            align="end"
            value={draft()}
            ariaLabel="Radius"
            inputMode="decimal"
            spellcheck={false}
            autocomplete="off"
            selectOnFocus
            invalid={refused()}
            onInput={(value) => {
              setRefused(false);
              setDraft(value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit(false);
              } else if (event.key === "Escape" && (draft() !== radius() || refused())) {
                event.preventDefault();
                event.stopPropagation();
                setDraft(radius());
                setRefused(false);
              }
            }}
            onBlur={() => commit(true)}
          />
        </span>
      </span>
    </div>
  );
}
