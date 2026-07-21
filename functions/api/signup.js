// POST /api/signup - stores an early-access sign-up in D1.
// Server-side validation mirrors the client so the form cannot be bypassed.
// The "company" field is a honeypot: humans never see it, bots fill it.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FREE_TEXT_MAX = 120;

function bad(status, message) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clean(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().slice(0, FREE_TEXT_MAX);
  return v.length ? v : null;
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return bad(400, "Could not read the form.");
  }

  // Honeypot: any value means a bot. Answer as if it worked.
  if (typeof body.company === "string" && body.company.length > 0) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  // A human takes longer than three seconds to fill a three-step form.
  if (typeof body.elapsed !== "number" || body.elapsed < 3000) {
    return bad(400, "That was too quick. Try again.");
  }

  const name = clean(body.name);
  const email = clean(body.email)?.toLowerCase() ?? null;
  if (!name) return bad(400, "Add your name.");
  if (!email || !EMAIL.test(email)) return bad(400, "That email address does not look right.");
  if (body.consent !== true) return bad(400, "Sign-up needs your consent to store these details.");

  const row = {
    name,
    email,
    role: clean(body.role),
    industry: clean(body.industry),
    converts: clean(body.converts),
    tools: clean(body.tools),
    breaks: clean(body.breaks),
  };

  try {
    await context.env.DB.prepare(
      `INSERT INTO signups (email, name, role, industry, converts, tools, breaks, consent, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8)`
    )
      .bind(
        row.email,
        row.name,
        row.role,
        row.industry,
        row.converts,
        row.tools,
        row.breaks,
        new Date().toISOString()
      )
      .run();
  } catch (err) {
    if (String(err).includes("UNIQUE")) {
      // Already signed up: that is a success from the visitor's side.
      return new Response(JSON.stringify({ ok: true, already: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return bad(500, "Something went wrong on our side. Try again in a minute.");
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return bad(405, "POST only.");
}
