<template>
  <router-view></router-view>
  <ToastHost />
</template>

<script setup>
import ToastHost from './components/ui/ToastHost.vue'
</script>

<style>
html,
body,
#app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
}

body {
  overflow: hidden;
}
</style>
