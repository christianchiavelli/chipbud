<template>
  <button type="button" @click="fire">go</button>
</template>

<script>
export default {
  methods: {
    fire() {
      this.$emit('fired')
    },
  },
}
</script>
