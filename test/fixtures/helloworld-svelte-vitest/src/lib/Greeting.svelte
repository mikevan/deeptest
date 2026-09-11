<script lang="ts">
  import { hello } from './greet';

  /** The one tested component. It shows the classic greeting. */
  let { name }: { name: string } = $props();
  const text = $derived(hello(name));
</script>

<h1>{text}</h1>
