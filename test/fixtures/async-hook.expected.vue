<template>
  <div>{{ ready }}</div>
</template>

<script setup>
import { onMounted, ref } from 'vue'

const ready = ref(false)
function load() {
  return Promise.resolve()
}
onMounted(async () => {
  await load()
  ready.value = true
})
</script>
