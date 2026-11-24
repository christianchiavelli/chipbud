<template>
  <div>{{ total }}</div>
</template>

<script>
export default {
  props: { step: Number },
  data() {
    return { total: 0 }
  },
  methods: {
    bump: (n) => n + 1,
  },
  watch: {
    total(value, previous) {
      console.log(value, previous, this.step)
    },
  },
  created() {
    this.total = this.step
  },
  beforeDestroy() {
    console.log('bye', this.total)
  },
}
</script>
