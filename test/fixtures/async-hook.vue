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
  async mounted() {
    await this.load()
    this.ready = true
  },
  methods: {
    load() {
      return Promise.resolve()
    },
  },
}
</script>
