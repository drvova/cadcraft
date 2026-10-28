// Caption: Every variant at both sizes.
import { IconButton } from "../../../../src/ui/IconButton";

export default function MatrixVariantSize() {
  return (
    <div>
      <IconButton icon="attach" title="Attach" variant="ghost" size="md" />
      <IconButton icon="attach" title="Attach" variant="ghost" size="sm" />
      <IconButton icon="list" title="List" variant="soft" size="md" />
      <IconButton icon="list" title="List" variant="soft" size="sm" />
      <IconButton icon="send" title="Send" variant="inverted" size="md" />
      <IconButton icon="send" title="Send" variant="inverted" size="sm" />
    </div>
  );
}
