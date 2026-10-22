import { createRouter, createWebHistory } from 'vue-router'
import axios from 'axios'
import { toast } from '../ui/feedback.js'

const AdminLayout = () => import('../layouts/AdminLayout.vue')

const routes = [
  {
    name: 'auth',
    path: '/auth',
    component: () => import('../views/auth.vue')
  },
  {
    path: '/',
    component: AdminLayout,
    children: [
      { path: '', redirect: '/accounts' },
      {
        name: 'accounts',
        path: 'accounts',
        component: () => import('../views/dashboard.vue'),
        meta: { titleKey: 'shell.nav.accounts', adminOnly: true }
      },
      {
        name: 'usage',
        path: 'usage',
        component: () => import('../views/statistics.vue'),
        meta: { titleKey: 'shell.nav.usage', adminOnly: true }
      },
      {
        name: 'settings',
        path: 'settings',
        component: () => import('../views/settings.vue'),
        meta: { titleKey: 'shell.nav.settings', adminOnly: true }
      },
      {
        name: 'chat',
        path: 'chat',
        component: () => import('../views/chat.vue'),
        meta: { titleKey: 'shell.nav.chat' }
      }
    ]
  },
  // 旧地址兼容：老书签 / 老文档里的链接继续可用
  { path: '/statistics', redirect: '/usage' },
  { path: '/dashboard', redirect: '/accounts' },
  { path: '/:pathMatch(.*)*', redirect: '/accounts' }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫：校验 apiKey，并区分管理员页面
router.beforeEach(async (to) => {
  if (to.path === '/auth') return true

  const apiKey = localStorage.getItem('apiKey')
  if (!apiKey) {
    toast.warn('请先登录管理后台')
    return { path: '/auth' }
  }

  try {
    const verifyResponse = await axios.post('/verify', { apiKey })
    if (verifyResponse.data.status !== 200) {
      localStorage.removeItem('apiKey')
      localStorage.removeItem('isAdmin')
      return { path: '/auth' }
    }

    const isAdmin = Boolean(verifyResponse.data.isAdmin)
    localStorage.setItem('isAdmin', isAdmin.toString())

    if (to.matched.some(record => record.meta.adminOnly) && !isAdmin) {
      toast.error('您没有访问管理页面的权限')
      return { path: '/auth' }
    }

    return true
  } catch (error) {
    localStorage.removeItem('apiKey')
    localStorage.removeItem('isAdmin')
    return { path: '/auth' }
  }
})

export default router
