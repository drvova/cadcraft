// Caption: The search field, for the command line.
import { Field } from "../../../../src/ui/Field";

export default function TypeSearch() {
  return <Field type="search" value="" placeholder="Search commands" ariaLabel="Search" onInput={() => undefined} />;
}
