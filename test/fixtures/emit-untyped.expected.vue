<template>
  <button type="button" @click="fire">go</button>
</template>

<script setup>
const emit = defineEmits()
function fire() {
  emit('fired')
}
</script>
