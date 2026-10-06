import { redirect } from 'next/navigation';

/** Compatibility entry point; History is the canonical route. */
export default function ActivityCompatibilityPage() {
  redirect('/history');
}
