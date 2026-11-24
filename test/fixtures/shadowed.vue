<template>
  <div>{{ count }}</div>
</template>

<script>
export default {
  data() {
    return {
      count: 0,
    }
  },
  methods: {
    reset(count) {
      this.count = count
    },
  },
}
</script>
