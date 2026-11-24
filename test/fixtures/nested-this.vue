<template>
  <div>{{ count }}</div>
</template>

<script>
export default {
  methods: {
    wire(el) {
      el.addEventListener('click', function () {
        this.count += 1
      })
    },
  },
}
</script>
