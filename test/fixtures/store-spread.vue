<template>
  <div>{{ userInfo.name }} {{ count }}</div>
</template>

<script>
import { mapActions, mapGetters, mapState } from 'vuex'

export default {
  computed: {
    ...mapGetters('user', ['userInfo']),
    ...mapState(['count']),
  },
  methods: {
    ...mapActions(['load']),
    refresh() {
      this.load()
      console.log(this.userInfo.name, this.count)
    },
  },
}
</script>
