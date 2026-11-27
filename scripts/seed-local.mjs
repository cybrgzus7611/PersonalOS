// Seed the local development database through the running dev server (`npm run dev` first).
const base = process.env.POS_URL ?? "http://localhost:8787";
const res = await fetch(`${base}/api/admin/seed`, { method: "POST" });
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Seeding failed (${res.status}):`, body?.error?.message ?? body);
  console.error("Is `npm run dev` running, and does .dev.vars contain ENVIRONMENT=development?");
  process.exit(1);
}
console.log(body.seeded ? `Seeded ${body.workstreams} workstreams and ${body.documents} documents.` : "Already seeded; nothing changed.");
