// Owner: Archit (frozen; ask before changing) | Router: every registry page is registered here up front
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Audit from './pages/Audit.jsx';
import Batches from './pages/Batches.jsx';
import Confirm from './pages/Confirm.jsx';
import Records from './pages/Records.jsx';
import Tamper from './pages/Tamper.jsx';
import Upload from './pages/Upload.jsx';

function NotFound() {
  return <h1 className="text-2xl font-semibold">Page not found</h1>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Upload />} />
          <Route path="confirm/:recordId" element={<Confirm />} />
          <Route path="records" element={<Records />} />
          <Route path="batches" element={<Batches />} />
          <Route path="audit" element={<Audit />} />
          <Route path="demo" element={<Tamper />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
