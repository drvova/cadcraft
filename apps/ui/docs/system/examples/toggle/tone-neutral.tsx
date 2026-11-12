// Caption: Neutral: on is the full ink over the quiet one.
import { Toggle } from "../../../../src/ui/Toggle";

export default function ToneNeutral() {
  return <Toggle tone="neutral" pressed icon="eye-off" iconOn="eye" ariaLabel="Preview" hint="Hide the preview" />;
}
