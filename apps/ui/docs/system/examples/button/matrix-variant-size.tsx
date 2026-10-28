// Caption: Every variant at both sizes.
import { Button } from "../../../../src/ui/Button";

export default function MatrixVariantSize() {
  return (
    <div>
      <Button variant="primary" size="md">Primary md</Button>
      <Button variant="primary" size="sm">Primary sm</Button>
      <Button variant="secondary" size="md">Secondary md</Button>
      <Button variant="secondary" size="sm">Secondary sm</Button>
      <Button variant="ghost" size="md">Ghost md</Button>
      <Button variant="ghost" size="sm">Ghost sm</Button>
      <Button variant="danger" size="md">Danger md</Button>
      <Button variant="danger" size="sm">Danger sm</Button>
    </div>
  );
}
