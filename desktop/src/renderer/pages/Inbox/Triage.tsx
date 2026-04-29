import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PagePlaceholder } from "../../components/PagePlaceholder";

// Stub for /inbox/triage. CL-04 (Triage focused mode) will replace
// this with the real one-item-at-a-time UI. The query param `id`
// telegraphs which item the list view focused on so CL-04 can deep-
// link into the queue without re-fetching.
export function Triage() {
  const [params] = useSearchParams();
  const itemId = params.get("id");

  return (
    <section className="flex-1 flex flex-col">
      <div className="px-12 pt-8">
        <Link
          to="/inbox"
          className="inline-flex items-center gap-2 text-xs font-medium tracking-wide text-stone-500 hover:text-stone-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Back to Inbox
        </Link>
      </div>
      <PagePlaceholder
        title="Triage"
        subtitle={
          itemId
            ? "Focused mode for one inbox item at a time. Real UI ships in CL-04."
            : "Walk the unsorted queue one at a time. Real UI ships in CL-04."
        }
        todo={itemId ? `CL-04 will land focused on ${itemId.slice(0, 8)}…` : "CL-04 owns the focused triage page"}
      />
    </section>
  );
}
