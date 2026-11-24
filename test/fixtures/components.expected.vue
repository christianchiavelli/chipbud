<template>
  <Child v-if="open" />
</template>

<script setup>
import { ref } from 'vue'
import Child from './Child.vue'

const open = ref(false)
</script>
