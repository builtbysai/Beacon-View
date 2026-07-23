export function App() {
  return (
    <main>
      <section className="card" aria-labelledby="page-title">
        <p className="eyebrow">Milestone 0</p>
        <h1 id="page-title">Beacon SecureView</h1>
        <p>
          The secure camera foundation is ready. Camera access, account
          features, and live viewing will be introduced only in later approved
          milestones.
        </p>
        <div className="status" role="status">
          <span aria-hidden="true" /> Foundation only — no media capture is
          active
        </div>
      </section>
    </main>
  );
}
