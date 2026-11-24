<template>
  <div>{{ count }}</div>
</template>

<script>
export default {
  mixins: [counterMixin],
  data() {
    return {
      count: 0,
    }
  },
}
</script>
