<template>
  <span>{{ doubled }}</span>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const total = ref(0)
const doubled = computed(() => total.value * 2)
</script>
