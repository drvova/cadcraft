// Caption: The email field, for a phone keyboard and autofill.
import { Field } from "../../../../src/ui/Field";

export default function TypeEmail() {
  return <Field type="email" value="" placeholder="you@example.com" ariaLabel="Email" onInput={() => undefined} />;
}
