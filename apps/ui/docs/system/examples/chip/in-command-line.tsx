// Caption: The keyword row under the command input.
import { Chip } from "../../../../src/ui/Chip";

export default function InCommandLine() {
  return (
    <div class="cmd-chips">
      <Chip tone="accent" onClick={() => undefined}>line</Chip>
      <Chip tone="accent" onClick={() => undefined}>circle</Chip>
      <Chip tone="accent" onClick={() => undefined}>arc</Chip>
    </div>
  );
}
