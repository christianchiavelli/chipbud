<template>
  <div>{{ ready }}</div>
</template>

<script>
export default {
  data() {
    return {
      ready: false,
    }
  },
  async created() {
    this.ready = await Promise.resolve(true)
  },
}
</script>
