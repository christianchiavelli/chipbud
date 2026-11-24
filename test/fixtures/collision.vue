<template>
  <div>{{ format }}</div>
</template>

<script>
import { format } from './format'

export default {
  data() {
    return {
      format: 'short',
    }
  },
}
</script>
