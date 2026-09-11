<script setup lang="ts">
import { computed } from 'vue';
import { hello } from '../greet';

/** The one tested component. It shows the classic greeting. */
const props = defineProps<{ name: string }>();
const text = computed(() => hello(props.name));
</script>

<template>
  <h1>{{ text }}</h1>
</template>
