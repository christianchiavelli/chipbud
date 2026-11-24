<template>
  <input ref="input" />
</template>

<script>
export default {
  methods: {
    focus() {
      this.$refs.input.focus()
    },
  },
}
</script>
