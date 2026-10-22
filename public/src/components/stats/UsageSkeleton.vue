<template>
  <div>
    <!-- KPI 骨架 -->
    <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <div v-for="index in 6" :key="index" class="card p-4">
        <div class="skeleton h-3 w-16"></div>
        <div class="skeleton mt-3 h-7 w-24"></div>
        <div class="skeleton mt-2 h-3 w-20"></div>
      </div>
    </div>

    <!-- 图表骨架 -->
    <div class="card mt-4">
      <div class="card-header">
        <div class="skeleton h-4 w-32"></div>
        <div class="skeleton h-4 w-24"></div>
      </div>
      <div class="card-body">
        <div class="skeleton h-[300px] w-full sm:h-[340px]"></div>
      </div>
    </div>

    <!-- 表格骨架 -->
    <div class="card mt-4">
      <div class="card-header">
        <div class="skeleton h-4 w-28"></div>
      </div>
      <div class="card-body space-y-3">
        <div v-for="index in 4" :key="index" class="skeleton h-9 w-full"></div>
      </div>
    </div>
  </div>
</template>
