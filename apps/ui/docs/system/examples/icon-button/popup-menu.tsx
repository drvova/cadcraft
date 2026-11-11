// Caption: A key that opens a menu, announced as a collapsed menu button.
import { IconButton } from "../../../../src/ui/IconButton";

export default function PopupMenu() {
  return <IconButton icon="list" title="Main menu" popup="menu" expanded={false} />;
}
