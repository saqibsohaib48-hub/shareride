import { notFound } from 'next/navigation';

const DOCS: Record<string, { title: string; points: string[] }> = {
  terms: { title: 'Terms & Conditions', points: ['Share Ride is a marketplace connecting people travelling in the same direction; it is not a transport operator.', 'Drivers set prices within platform limits; Share Ride charges a disclosed platform fee.', 'Cancellations and refunds follow the policy shown on each ride.', 'Members must follow the Community Guidelines and local laws.'] },
  privacy: { title: 'Privacy Policy', points: ['We only reveal the information needed to complete a ride (first name, initial, rating, vehicle).', 'Phone numbers, email, documents and payment details are never shown publicly.', 'Live location is used only during an active trip.', 'You can delete your account from your profile at any time.'] },
  community: { title: 'Community Guidelines', points: ['Be on time, be respectful, be safe.', 'No discrimination, harassment or unsafe driving.', 'Keep payments and messages inside the app.'] },
  safety: { title: 'Safety Policy', points: ['Verification levels: phone, email, identity, driver.', 'Report safety concerns from the Safety Center — they are handled with urgent priority.'] },
  refunds: { title: 'Refund Policy', points: ['Refunds follow the cancellation tiers shown on each ride.', 'If the driver cancels, passengers receive the configured refund (default 100%).'] },
  driver: { title: 'Driver Terms', points: ['Drivers must hold a valid licence and insurance as required locally.', 'Earnings are released when a ride is completed.'] },
};

export default function LegalPage({ params }: { params: { doc: string } }) {
  const d = DOCS[params.doc];
  if (!d) notFound();
  return (
    <article className="card stack" style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="alert warn"><b>Template.</b> This document is a placeholder outline. It must be drafted and reviewed by qualified legal counsel for each country/jurisdiction before launch.</div>
      <h1>{d.title}</h1>
      <ul>{d.points.map((p) => <li key={p}>{p}</li>)}</ul>
    </article>
  );
}
