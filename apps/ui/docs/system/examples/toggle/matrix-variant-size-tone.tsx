// Caption: Both faces at both sizes, and every tone off and on.
import { Toggle } from "../../../../src/ui/Toggle";

const TONES = ["neutral", "absent", "info", "caution"] as const;

export default function MatrixVariantSizeTone() {
  return (
    <div>
      {TONES.map((tone) => (
        <span>
          <Toggle size="sm" tone={tone} pressed={false} icon="layer.off" iconOn="layer.on" ariaLabel={`${tone}, small`} />
          <Toggle size="sm" tone={tone} pressed icon="layer.off" iconOn="layer.on" ariaLabel={`${tone}, small`} />
          <Toggle size="md" tone={tone} pressed={false} icon="layer.off" iconOn="layer.on" ariaLabel={`${tone}, medium`} />
          <Toggle size="md" tone={tone} pressed icon="layer.off" iconOn="layer.on" ariaLabel={`${tone}, medium`} />
        </span>
      ))}
      <Toggle variant="text" size="sm" pressed={false}>
        Snap
      </Toggle>
      <Toggle variant="text" size="sm" pressed>
        Snap
      </Toggle>
      <Toggle variant="text" size="md" pressed={false}>
        Snap
      </Toggle>
      <Toggle variant="text" size="md" pressed>
        Snap
      </Toggle>
    </div>
  );
}
