// Caption: A blocked tool at the disabled ink.
import { IconButton } from "../../../../src/ui/IconButton";

/** Disabled, and still reachable: the hint names the key and `description` says why it is blocked. */
export default function Disabled() {
  return <IconButton icon="send" title="Send" disabled description="Type a message first" />;
}
