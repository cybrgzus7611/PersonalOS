const el = document.getElementById("health");
fetch("/api/health")
  .then((r) => r.json())
  .then((h) => { el.textContent = h.ok ? `API OK. Migrations applied: ${h.migrations.join(", ") || "none"}.` : "API not healthy."; })
  .catch(() => { el.textContent = "API not reachable."; });
