// Caption: A fold key over the region it folds, announced expanded.
import { IconButton } from "../../../../src/ui/IconButton";

export default function Expanded() {
  return (
    <section>
      <IconButton icon="chevron-down" size="sm" title="Hide the layers" expanded controls="layers-body" />
      <div id="layers-body">Outline, Center, Hidden</div>
    </section>
  );
}
