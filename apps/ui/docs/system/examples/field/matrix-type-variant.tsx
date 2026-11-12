// Caption: Every input type in each of the three looks.
import { Field } from "../../../../src/ui/Field";

export default function MatrixTypeVariant() {
  return (
    <div>
      <Field type="text" variant="field" value="Walls" ariaLabel="Name, text, field" onInput={() => undefined} />
      <Field type="text" variant="inline" value="Walls" ariaLabel="Name, text, inline" onInput={() => undefined} />
      <Field type="text" variant="bare" value="Walls" ariaLabel="Name, text, bare" onInput={() => undefined} />
      <Field type="email" variant="field" value="you@example.com" ariaLabel="Email, field" onInput={() => undefined} />
      <Field type="email" variant="inline" value="you@example.com" ariaLabel="Email, inline" onInput={() => undefined} />
      <Field type="email" variant="bare" value="you@example.com" ariaLabel="Email, bare" onInput={() => undefined} />
      <Field type="search" variant="field" value="circle" ariaLabel="Search, field" onInput={() => undefined} />
      <Field type="search" variant="inline" value="circle" ariaLabel="Search, inline" onInput={() => undefined} />
      <Field type="search" variant="bare" value="circle" ariaLabel="Search, bare" onInput={() => undefined} />
      <Field type="password" variant="field" value="sk-0000" ariaLabel="API key, field" autocomplete="off" onInput={() => undefined} />
      <Field type="password" variant="inline" value="sk-0000" ariaLabel="API key, inline" autocomplete="off" onInput={() => undefined} />
      <Field type="password" variant="bare" value="sk-0000" ariaLabel="API key, bare" autocomplete="off" onInput={() => undefined} />
    </div>
  );
}
