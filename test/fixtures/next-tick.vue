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
    bump() {
      this.count += 1
      this.$nextTick(() => {
        console.log(this.count)
      })
    },
  },
}
</script>
