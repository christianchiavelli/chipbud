<template>
  <button type="button" @click="increment">{{ label }}</button>
</template>

<script>
export default {
  data() {
    return {
      count: 0,
    }
  },
  computed: {
    label() {
      return `Clicked ${this.count} times`
    },
  },
  methods: {
    increment() {
      this.count += 1
    },
  },
  mounted() {
    console.log('mounted at', this.count)
  },
}
</script>
