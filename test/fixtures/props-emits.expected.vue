<template>
  <span>{{ currency }} {{ amount }}</span>
</template>

<script setup>
defineOptions({ name: 'PriceTag' })
const props = defineProps({
  amount: Number,
  currency: String,
})
const emit = defineEmits(['change'])
function raise() {
  emit('change', props.amount * 2)
  console.log(props.currency)
}
</script>
