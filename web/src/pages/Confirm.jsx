// Owner: Mahendra | Confirm screen: review AI suggestions + evidence, edit, confirm metadata
import { useParams } from 'react-router-dom';

export default function Confirm() {
  const { recordId } = useParams();
  return (
    <section>
      <h1 className="text-2xl font-semibold">Confirm metadata</h1>
      <p className="mt-2 text-slate-600">Record {recordId}. Coming soon.</p>
    </section>
  );
}
