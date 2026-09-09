import { redirect } from 'next/navigation';

/** The app entry point is the wallet-owned portfolio workspace. */
export default function HomePage() {
  redirect('/portfolio');
}
