// Routes. Login has no layout; every other page sits inside the Layout.
import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { NotYet } from './components/Page'
import Control from './pages/Control'
import RunLive from './pages/RunLive'
import Runs from './pages/Runs'
import Approvals from './pages/Approvals'
import ApprovalDetail from './pages/ApprovalDetail'
import Content from './pages/Content'
import RecordDetail from './pages/RecordDetail'
import Pinned from './pages/Pinned'
import Lessons from './pages/Lessons'
import Settings from './pages/Settings'
import Login from './pages/Login'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="*"
        element={
          <Layout>
            <Routes>
              <Route path="/" element={<Control />} />
              <Route path="/runs" element={<Runs />} />
              <Route path="/runs/:runId" element={<RunLive />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/approvals/:briefId" element={<ApprovalDetail />} />
              <Route path="/content" element={<Content />} />
              <Route path="/records/:memoryId" element={<RecordDetail />} />
              <Route path="/pinned" element={<Pinned />} />
              <Route path="/lessons" element={<Lessons />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotYet title="Not found" task="no task: this address does not exist" />} />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  )
}
