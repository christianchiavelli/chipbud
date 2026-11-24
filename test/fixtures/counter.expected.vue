<template>
  <button type="button" @click="increment">{{ label }}</button>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'

const count = ref(0)
const label = computed(() => `Clicked ${count.value} times`)
function increment() {
  count.value += 1
}
onMounted(() => {
  console.log('mounted at', count.value)
})
</script>
