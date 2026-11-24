<template>
  <div>{{ userInfo.name }} {{ count }}</div>
</template>

<script setup>
import { computed } from 'vue'
import { useStore } from 'vuex'

const store = useStore()
const userInfo = computed(() => store.getters['user/userInfo'])
const count = computed(() => store.state.count)
const load = (...args) => store.dispatch('load', ...args)
function refresh() {
  load()
  console.log(userInfo.name, count)
}
</script>
