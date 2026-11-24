<template>
  <div>{{ total }}</div>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({ step: Number })
const total = ref(0)
const bump = (n) => n + 1
onBeforeUnmount(() => {
  console.log('bye', total.value)
})
watch(total, (value, previous) => {
  console.log(value, previous, props.step)
})
total.value = props.step
</script>
