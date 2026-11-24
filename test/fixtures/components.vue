<template>
  <Child v-if="open" />
</template>

<script>
import Child from './Child.vue'

export default {
  components: { Child },
  data() {
    return { open: false }
  },
}
</script>
