import { useRoute } from './lib/router'
import { Dashboard } from './pages/Dashboard'
import { History } from './pages/History'

export function App() {
  const route = useRoute()
  return route === '/history' ? <History /> : <Dashboard />
}
