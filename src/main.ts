import { createApp } from 'vue'
import naive from 'naive-ui'
import App from './App.vue'
import router from './router'
import 'virtual:uno.css'
import './styles/global.css'

const app = createApp(App)
app.use(router)
app.use(naive)
app.mount('#app')
