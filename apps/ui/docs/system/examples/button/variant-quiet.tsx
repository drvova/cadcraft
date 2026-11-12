// Caption: An action that stands back beside the title it changes.
import { Button } from "../../../../src/ui/Button";

export default function VariantQuiet() {
  return (
    <div>
      <h2>Ollama</h2>
      <Button variant="quiet" size="sm" title="Choose another provider">
        Change
      </Button>
    </div>
  );
}
