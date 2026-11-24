<template>
  <span>{{ doubled }}</span>
</template>

<script lang="ts">
export default {
  data(): { total: number } {
    return {
      total: 0,
    }
  },
  computed: {
    doubled(): number {
      return this.total * 2
    },
  },
}
</script>
