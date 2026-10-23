// Routes. Login has no layout; every other page sits inside the Layout. Pages load on demand (one chunk
// each), so the first screen does not download the Markdown renderer or the diff code.
import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { NotYet } from './components/Page'
import Login from './pages/Login'

const Control = lazy(() => import('./pages/Control'))
const RunLive = lazy(() => import('./pages/RunLive'))
const Runs = lazy(() => import('./pages/Runs'))
const Approvals = lazy(() => import('./pages/Approvals'))
const ApprovalDetail = lazy(() => import('./pages/ApprovalDetail'))
const Content = lazy(() => import('./pages/Content'))
const Memory = lazy(() => import('./pages/Memory'))
const RecordDetail = lazy(() => import('./pages/RecordDetail'))
const Pinned = lazy(() => import('./pages/Pinned'))
const Lessons = lazy(() => import('./pages/Lessons'))
const Settings = lazy(() => import('./pages/Settings'))
const Posts = lazy(() => import('./pages/Posts'))
const Exports = lazy(() => import('./pages/Exports'))
const Roadmap = lazy(() => import('./pages/Roadmap'))

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="*"
        element={
          <Layout>
            <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
              <Routes>
                <Route path="/" element={<Control />} />
                <Route path="/runs" element={<Runs />} />
                <Route path="/runs/:runId" element={<RunLive />} />
                <Route path="/approvals" element={<Approvals />} />
                <Route path="/approvals/:briefId" element={<ApprovalDetail />} />
                <Route path="/content" element={<Content />} />
                <Route path="/memory" element={<Memory />} />
                <Route path="/records/:memoryId" element={<RecordDetail />} />
                <Route path="/pinned" element={<Pinned />} />
                <Route path="/lessons" element={<Lessons />} />
                <Route path="/posts" element={<Posts />} />
                <Route path="/exports" element={<Exports />} />
                <Route path="/roadmap" element={<Roadmap />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<NotYet title="Not found" task="no task: this address does not exist" />} />
              </Routes>
            </Suspense>
          </Layout>
        }
      />
    </Routes>
  )
}
