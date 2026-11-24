<template>
  <div>{{ count }}</div>
</template>

<script setup>
import { nextTick, ref } from 'vue'

const count = ref(0)
function bump() {
  count.value += 1
  nextTick(() => {
    console.log(count.value)
  })
}
</script>
