<template>
  <span>{{ currency }} {{ amount }}</span>
</template>

<script>
export default {
  name: 'PriceTag',
  props: {
    amount: Number,
    currency: String,
  },
  emits: ['change'],
  methods: {
    raise() {
      this.$emit('change', this.amount * 2)
      console.log(this.currency)
    },
  },
}
</script>
