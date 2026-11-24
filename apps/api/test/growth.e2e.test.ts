import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { validateEvent } from "@kiorex/contracts";
import type { PrismaClient, StaffRole } from "../src/generated/prisma/client";
import { verifyLinkTouch } from "../src/modules/growth/link-touch";
import { type Lab, type TestApp, bootApp, call, makeLab } from "./helpers/app";
import { post } from "./helpers/hmac";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
const CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const snap = (flags: Array<{ key: string; values: object }>) => ({ product: "kiorly-lab", version: Date.now(), generatedAt: new Date().toISOString(), flags: flags.map((f) => ({ class: "Module", dependsOn: [], launchLocked: false, gateSatisfied: false, ...f })) as never });

/** GRW-P4-B1 provider links for Kiorly Lab against a real database: lifecycle, role matrix, tenant isolation, plan gate, registry events, public resolver, signed lookup. */
describe("Growth provider links (lab)", () => {
  let t: TestApp, f: Lab, other: Lab, prisma: PrismaClient, kx: { key: string; secret: string }, kxOther: { key: string; secret: string };
  before(async () => {
    t = await bootApp(); prisma = t.prisma as unknown as PrismaClient;
    f = await makeLab(t); other = await makeLab(t);
    kx = (await call(t, "POST", "/integration-clients", { token: f.tokens.OWNER, body: { source: "KIOREX_BOOKING" } })).body; // a Kiorex client makes the lab a (legacy) connected lab
    kxOther = (await call(t, "POST", "/integration-clients", { token: other.tokens.OWNER, body: { source: "KIOREX_BOOKING" } })).body;
  });
  after(async () => { t.flags.setSnapshot(null); await t.close(); });

  const G = "/growth/links";
  const mk = async (body: object = {}, token = f.tokens.OWNER) => { const r = await call(t, "POST", G, { token, body: { label: `Link ${randomUUID().slice(0, 4)}`, ...body } }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body as { id: string; code: string; status: string; shortUrl: string; ownerScope: string; labId: string | null }; };
  const patch = (id: string, body: object, token = f.tokens.OWNER, base = G) => call(t, "PATCH", `${base}/${id}`, { token, body });
  const lookup = (c: { key: string; secret: string }, path: string) => post(t, c, path, undefined, { method: "GET" });
  const events = (orgId: string, type: string) => prisma.outboxEvent.findMany({ where: { orgId, type }, orderBy: { occurredAt: "asc" } });
  /** The public resolver must not be followed: the redirect target is the Kiorex host, which is not running here. */
  const pub = (path: string, headers: Record<string, string> = { "user-agent": UA }) => fetch(`${t.base}/api/v1${path}`, { redirect: "manual", headers });
  const staff = async (lb: Lab, role: StaffRole, labIds: string[]) => { const s = await prisma.staffUser.create({ data: { orgId: lb.orgId, email: `${role.toLowerCase()}.${randomUUID().slice(0, 6)}@${lb.slug}.test`, displayName: `${role} scoped`, role, labIds } }); return t.tokens.signDev({ staffId: s.id, amr: ["pwd", "mfa"] }); };
  const connect = async (lb: Lab) => (await call(t, "POST", "/integration-clients", { token: lb.tokens.OWNER, body: { source: "KIOREX_BOOKING" } })).body;

  it("owner creates an ORG link: 8-char code, short URL, audit row, signed ReferralLinkCreated with product LAB that validates against the contract", async () => {
    const l = await mk({ ownerScope: "ORG", channelKind: "WEB_LINK" });
    assert.match(l.code, CODE); assert.match(l.shortUrl, new RegExp(`/api/v1/public/links/q/${l.code}$`)); assert.equal(l.status, "ACTIVE");
    const ev = (await events(f.orgId, "ReferralLinkCreated")).find((e) => (e.payload as { data: { linkCode: string } }).data.linkCode === l.code)!;
    const p = ev.payload as { data: Record<string, unknown>; target: string; aggregateType: string };
    assert.equal(p.target, "KIOREX"); assert.equal(p.aggregateType, "ProviderReferralLink"); assert.equal(p.data.product, "LAB"); assert.equal(p.data.orgRef, f.orgId); assert.equal(p.data.ownerScope, "ORG");
    assert.equal(validateEvent("ReferralLinkCreated", ev.payload as never).valid, true);
    assert.ok(await prisma.auditLog.findFirst({ where: { orgId: f.orgId, action: "growth.link.created", entityId: l.id } }));
    assert.doesNotMatch(JSON.stringify(ev.payload), /patient|phone|email|price/i);
  });

  it("scopes: BRANCH (site) and DESK need a lab of the organisation, ORG must not carry one; a foreign lab is a 404 and the database refuses invalid rows", async () => {
    const b = await mk({ ownerScope: "BRANCH", labId: f.labId }); assert.equal(b.labId, f.labId);
    const d = await mk({ ownerScope: "DESK", labId: f.labId, label: "Reception 1" }); assert.equal(d.ownerScope, "DESK");
    for (const body of [{ ownerScope: "BRANCH" }, { ownerScope: "DOCTOR" }, { ownerScope: "ORG", label: "x" }, { ownerScope: "ORG", channelKind: "FAX" }, { ownerScope: "ORG", tags: { utm_source: "<b>" } }]) {
      const r = await call(t, "POST", G, { token: f.tokens.OWNER, body: { label: "Valid label", ...body } }); assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(r.body.code, "GROWTH_LINK_INVALID");
    }
    assert.equal((await call(t, "POST", G, { token: f.tokens.OWNER, body: { label: "Valid label", ownerScope: "BRANCH", labId: other.labId } })).status, 404);
    await assert.rejects(prisma.$executeRaw`INSERT INTO "ProviderReferralLink" ("id","orgId","ownerScope","code","label","createdBy") VALUES ('x1', ${f.orgId}, 'BRANCH', 'ABCDEFGH', 'no site', 'u')`);
    await assert.rejects(prisma.$executeRaw`INSERT INTO "ProviderReferralLink" ("id","orgId","ownerScope","code","label","createdBy") VALUES ('x2', ${f.orgId}, 'ORG', 'ABCDEFGI', 'bad code', 'u')`);
  });

  it("role matrix: owner, director and manager create; reception, supervisor, signatory and finance read; bench roles are refused; a site-scoped manager is limited to their own lab", async () => {
    for (const role of ["OWNER", "LAB_DIRECTOR", "BRANCH_MANAGER"] as const) assert.equal((await call(t, "POST", G, { token: f.tokens[role], body: { label: `By ${role}`, ownerScope: "ORG" } })).status, 201, role);
    for (const role of ["RECEPTION", "SUPERVISOR", "AUTHORIZED_SIGNATORY", "FINANCE"] as const) {
      assert.equal((await call(t, "GET", G, { token: f.tokens[role] })).status, 200, role);
      const r = await call(t, "POST", G, { token: f.tokens[role], body: { label: "Nope nope", ownerScope: "ORG" } }); assert.equal(r.status, 403, role); assert.equal(r.body.code, "GROWTH_FORBIDDEN");
    }
    for (const role of ["TECHNOLOGIST", "PHLEBOTOMIST"] as const) { const r = await call(t, "GET", G, { token: f.tokens[role] }); assert.equal(r.status, 403, role); assert.equal(r.body.code, "GROWTH_FORBIDDEN"); }
    const lab2 = await prisma.lab.create({ data: { orgId: f.orgId, name: "Second Lab", code: "SL" } });
    const mgr = await staff(f, "BRANCH_MANAGER", [f.labId]);
    const org = await mk({ ownerScope: "ORG" });
    const mine = await call(t, "POST", G, { token: mgr, body: { label: "My lab", ownerScope: "BRANCH" } }); // defaults to the manager's only lab
    assert.equal(mine.status, 201, JSON.stringify(mine.body)); assert.equal(mine.body.labId, f.labId);
    assert.equal((await call(t, "POST", G, { token: mgr, body: { label: "Org wide", ownerScope: "ORG" } })).body.code, "GROWTH_SCOPE_FORBIDDEN");
    assert.equal((await call(t, "POST", G, { token: mgr, body: { label: "Other lab", ownerScope: "BRANCH", labId: lab2.id } })).body.code, "GROWTH_SCOPE_FORBIDDEN");
    const foreign = await mk({ ownerScope: "DESK", labId: lab2.id });
    const seen = (await call(t, "GET", G, { token: mgr })).body.items as Array<{ id: string }>;
    assert.ok(seen.some((x) => x.id === org.id) && seen.some((x) => x.id === mine.body.id) && !seen.some((x) => x.id === foreign.id), "scoped manager sees org-wide and own-lab links only");
    assert.equal((await patch(foreign.id, { status: "PAUSED" }, mgr)).status, 404, "another lab's link is invisible");
    assert.equal((await patch(org.id, { status: "PAUSED" }, mgr)).body.code, "GROWTH_SCOPE_FORBIDDEN");
    assert.equal((await patch(mine.body.id, { status: "PAUSED" }, mgr)).status, 200);
    assert.equal((await patch(mine.body.id, { status: "ACTIVE" }, f.tokens.RECEPTION)).status, 403);
    const acc = (await call(t, "GET", "/growth/access", { token: f.tokens.RECEPTION })).body; assert.deepEqual([acc.level, acc.can.create, acc.can.view, acc.connected], ["read", false, true, true]);
  });

  it("lifecycle: pause and resume change the lookup status, revoke is permanent, emits ReferralLinkRevoked at once and the QR of a revoked link is refused", async () => {
    const l = await mk({ ownerScope: "ORG" });
    const look = async () => (await lookup(kx, `/integration/v1/referral-links/${l.code}`)).body;
    assert.equal((await look()).status, "ACTIVE"); assert.equal((await look()).product, "LAB");
    assert.equal((await patch(l.id, { status: "PAUSED" })).body.status, "PAUSED"); assert.equal((await look()).status, "PAUSED");
    assert.equal((await patch(l.id, { status: "ACTIVE", label: "Renamed link" })).body.label, "Renamed link");
    assert.equal((await patch(l.id, { status: "BOGUS" })).status, 400);
    const rev = await patch(l.id, { status: "REVOKED" }); assert.equal(rev.status, 200); assert.equal(rev.body.status, "REVOKED");
    const l2 = await look(); assert.equal(l2.status, "REVOKED"); assert.ok(l2.revokedAt, "revoked is visible to Kiorex immediately");
    const ev = (await events(f.orgId, "ReferralLinkRevoked")).find((e) => (e.payload as { data: { linkCode: string } }).data.linkCode === l.code)!;
    assert.equal(validateEvent("ReferralLinkRevoked", ev.payload as never).valid, true); assert.equal((ev.payload as { data: { product: string } }).data.product, "LAB");
    assert.equal((await patch(l.id, { status: "ACTIVE" })).status, 409);
    assert.equal((await call(t, "GET", `${G}/${l.id}/qr.svg`, { token: f.tokens.OWNER })).status, 409);
    assert.equal((await patch(l.id, { label: "Edit after revoke" })).status, 200);
  });

  it("QR (SVG, PNG) and printable cards (AR and EN, A4 and A5, desk card)", async () => {
    const l = await mk({ ownerScope: "DESK", labId: f.labId, label: "Reception 1" });
    const svg = await call(t, "GET", `${G}/${l.id}/qr.svg`, { token: f.tokens.OWNER });
    assert.equal(svg.status, 200); assert.match(svg.headers.get("content-type")!, /image\/svg\+xml/); assert.match(svg.body as string, /^<svg/);
    const png = await call(t, "GET", `${G}/${l.id}/qr.png?width=400`, { token: f.tokens.OWNER });
    assert.equal(png.status, 200); assert.equal(png.raw.subarray(1, 4).toString(), "PNG");
    const ar = await call(t, "GET", `${G}/${l.id}/poster?lang=ar&size=A5`, { token: f.tokens.OWNER });
    assert.equal(ar.status, 200); assert.match(ar.body as string, /dir="rtl"/); assert.match(ar.body as string, /Reception 1/); assert.match(ar.body as string, new RegExp(l.code)); assert.match(ar.body as string, /كيورلي لاب/); assert.doesNotMatch(ar.body as string, /<script/);
    assert.match((await call(t, "GET", `${G}/${l.id}/poster?lang=en&kind=POSTER`, { token: f.tokens.OWNER })).body as string, /dir="ltr"/);
    assert.match((await call(t, "GET", `${G}/${l.id}/poster?print=1`, { token: f.tokens.OWNER })).body as string, /window\.print/);
    assert.equal((await call(t, "GET", `${G}/${l.id}/qr.svg`, { token: f.tokens.RECEPTION })).status, 200, "the desk prints its own card");
  });

  it("tenant isolation: another organisation can neither see, change, print nor look up a link (IDOR)", async () => {
    const l = await mk({ ownerScope: "ORG" }); const them = other.tokens.OWNER;
    assert.equal(((await call(t, "GET", G, { token: them })).body.items as Array<{ id: string }>).some((x) => x.id === l.id), false);
    for (const p of [`${G}/${l.id}/qr.svg`, `${G}/${l.id}/qr.png`, `${G}/${l.id}/poster`]) assert.equal((await call(t, "GET", p, { token: them })).status, 404, p);
    assert.equal((await patch(l.id, { status: "REVOKED" }, them)).status, 404);
    assert.equal((await call(t, "GET", `${G}/${l.id}/qr.svg`, { token: f.tokens.OWNER })).status, 200, "still intact");
    assert.equal((await lookup(kxOther, `/integration/v1/referral-links/${l.code}`)).status, 404, "a Kiorex client key of another organisation cannot read it");
    assert.equal(((await lookup(kxOther, "/integration/v1/referral-links")).body.items as Array<{ code: string }>).some((x) => x.code === l.code), false);
    assert.equal(((await lookup(kx, "/integration/v1/referral-links")).body.items as Array<{ code: string }>).some((x) => x.code === l.code), true);
    assert.equal((await call(t, "GET", `/integration/v1/referral-links/${l.code}`)).status, 401, "unsigned");
    assert.equal((await lookup(kx, "/integration/v1/referral-links/NOTACODE1")).status, 404);
    const clinic = (await call(t, "POST", "/integration-clients", { token: f.tokens.OWNER, body: { source: "KIORLY_CLINIC" } })).body;
    assert.equal((await lookup(clinic, `/integration/v1/referral-links/${l.code}`)).status, 404, "only the Kiorex booking client reads the registry");
    assert.equal(((await call(t, "GET", "/growth/summary", { token: them })).body.byLink as Array<{ linkId: string }>).some((x) => x.linkId === l.id), false);
  });

  it("lookup feed: oldest first, cursor paged, only this organisation", async () => {
    const page1 = (await lookup(kx, "/integration/v1/referral-links?limit=2")).body; assert.equal(page1.items.length, 2); assert.ok(page1.nextCursor);
    const page2 = (await lookup(kx, `/integration/v1/referral-links?limit=2&cursor=${page1.nextCursor}`)).body;
    assert.equal(page2.items.some((x: { code: string }) => page1.items.some((y: { code: string }) => y.code === x.code)), false);
    for (const it of [...page1.items, ...page2.items]) { assert.equal(it.orgRef, f.orgId); assert.equal(it.product, "LAB"); }
  });

  it("public resolver: 302 to the Kiorex lab page with a verifiable lt, UTM tags, one visit per non-bot hit, no PII stored; bots are not counted", async () => {
    const l = await mk({ ownerScope: "DESK", labId: f.labId, channelKind: "QR_DESK", tags: { utm_campaign: "desk-26" } });
    const res = await pub(`/public/links/q/${l.code.toLowerCase()}`, { "user-agent": UA, "x-forwarded-for": "203.0.113.9" });
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get("location")!); assert.equal(loc.pathname, "/lab"); assert.equal(loc.origin, new URL(process.env.KIOREX_PATIENT_WEB_URL ?? "http://localhost:5180").origin);
    assert.equal(loc.searchParams.get("utm_medium"), "qr"); assert.equal(loc.searchParams.get("utm_campaign"), "desk-26");
    const v = verifyLinkTouch(loc.searchParams.get("lt")); assert.ok(v.ok); if (v.ok) { assert.equal(v.claims.o, f.orgId); assert.equal(v.claims.c, l.code); }
    await pub(`/public/links/q/${l.code}`, { "user-agent": "curl/8.4.0" });
    await pub(`/public/links/q/${l.code}`, { "user-agent": UA, purpose: "prefetch" });
    const day = await prisma.providerReferralLinkDaily.findMany({ where: { linkId: l.id } });
    assert.equal(day.length, 1); assert.equal(day[0]!.visits, 1); assert.equal(day[0]!.orders, 0);
    assert.equal(Object.keys(day[0]!).sort().join(), "completed,date,linkId,orders,orgId,updatedAt,visits", "counters only: no visitor column exists");
    assert.doesNotMatch(JSON.stringify(await prisma.rateLimitBucket.findMany({ where: { key: { startsWith: "plink:" } } })), /203\.0\.113\.9/);
    const json = await fetch(`${t.base}/api/v1/public/links/q/${l.code}`, { redirect: "manual", headers: { "user-agent": UA, accept: "application/json" } });
    const jb = (await json.json()) as { status: string; target: string }; assert.equal(json.status, 200); assert.equal(jb.status, "ACTIVE"); assert.match(jb.target, /\/lab\?lt=/);
    assert.equal((await call(t, "GET", "/growth/summary", { token: f.tokens.OWNER })).body.byLink.find((x: { linkId: string }) => x.linkId === l.id).visits, 2);
    assert.equal((await call(t, "GET", G, { token: f.tokens.OWNER })).body.items.find((x: { id: string }) => x.id === l.id).last30.visits, 2);
  });

  it("20 parallel visits count exactly 20 (atomic daily aggregate)", async () => {
    const l = await mk({ ownerScope: "ORG" });
    await Promise.all(Array.from({ length: 20 }, () => pub(`/public/links/q/${l.code}`)));
    assert.equal((await prisma.providerReferralLinkDaily.findFirstOrThrow({ where: { linkId: l.id } })).visits, 20);
  });

  it("open redirect: nothing the caller sends changes the destination; paused, revoked, unknown and malformed codes never attribute or leak", async () => {
    const l = await mk({ ownerScope: "ORG" });
    const kiorexHost = new URL(process.env.KIOREX_PATIENT_WEB_URL ?? "http://localhost:5180").host;
    for (const probe of [`?next=https://evil.test`, `?redirect=//evil.test`, `?url=javascript:alert(1)`, `?s=https://evil.test`]) {
      const r = await pub(`/public/links/q/${l.code}${probe}`, { "user-agent": UA, referer: "https://evil.test" });
      assert.equal(r.status, 302, probe); assert.equal(new URL(r.headers.get("location")!).host, kiorexHost, probe);
    }
    for (const bad of ["https:%2F%2Fevil.test", "%2F%2Fevil.test", "..%2F..%2Fetc%2Fpasswd", "ABCDEFGH", "7K3M9QX", "%00"]) {
      const r = await pub(`/public/links/q/${bad}`); assert.ok([404, 400].includes(r.status), `${bad} -> ${r.status}`); assert.equal(r.headers.get("location"), null);
    }
    await patch(l.id, { status: "PAUSED" });
    const before = (await prisma.providerReferralLinkDaily.aggregate({ where: { linkId: l.id }, _sum: { visits: true } }))._sum.visits ?? 0;
    const paused = await pub(`/public/links/q/${l.code}`);
    assert.equal(paused.status, 302); assert.equal(new URL(paused.headers.get("location")!).search, "", "paused: plain page, no token");
    await patch(l.id, { status: "REVOKED" });
    const revoked = await pub(`/public/links/q/${l.code}`); assert.equal(revoked.status, 302); assert.equal(new URL(revoked.headers.get("location")!).search, "");
    assert.equal((await prisma.providerReferralLinkDaily.aggregate({ where: { linkId: l.id }, _sum: { visits: true } }))._sum.visits ?? 0, before, "no counting once paused or revoked");
  });

  it("a lab that is not connected to Kiorex: every Growth route is 403 KIOREX_NOT_CONNECTED, the public link opens the plain page and counts nothing", async () => {
    const l = await mk({ ownerScope: "ORG" });
    await prisma.tenant.update({ where: { id: f.orgId }, data: { integrationMode: "STANDALONE" } });
    try {
      for (const p of ["/growth/links", "/growth/summary", "/growth/performance", "/growth/recommendations", `/growth/links/${l.id}/qr.svg`, `/growth/links/${l.id}/poster`, "/mobile/growth"]) {
        const r = await call(t, "GET", p, { token: f.tokens.OWNER }); assert.equal(r.status, 403, p); assert.equal(r.body.code, "KIOREX_NOT_CONNECTED", p);
      }
      assert.equal((await call(t, "POST", G, { token: f.tokens.OWNER, body: { label: "Valid label", ownerScope: "ORG" } })).body.code, "KIOREX_NOT_CONNECTED");
      assert.equal((await call(t, "GET", "/growth/access", { token: f.tokens.OWNER })).body.connected, false);
      const r = await pub(`/public/links/q/${l.code}`); assert.equal(r.status, 302); assert.equal(new URL(r.headers.get("location")!).search, "");
      assert.equal(await prisma.providerReferralLinkDaily.count({ where: { linkId: l.id } }), 0);
    } finally { await prisma.tenant.update({ where: { id: f.orgId }, data: { integrationMode: "INTEGRATED" } }); }
    assert.equal((await call(t, "GET", G, { token: f.tokens.OWNER })).status, 200);
    await prisma.auditLog.create({ data: { orgId: f.orgId, action: "kiorex_connect.state", entityType: "KiorexConnect", entityId: f.orgId, meta: { status: "PAUSED" } } }); // a paused Kiorex connection is not connected either
    assert.equal((await call(t, "GET", G, { token: f.tokens.OWNER })).body.code, "KIOREX_NOT_CONNECTED");
    await prisma.auditLog.create({ data: { orgId: f.orgId, action: "kiorex_connect.state", entityType: "KiorexConnect", entityId: f.orgId, meta: { status: "APPROVED" } } });
    assert.equal((await call(t, "GET", G, { token: f.tokens.OWNER })).status, 200);
  });

  it("flag growth.provider_links OFF: nothing new can be created or printed, existing links keep resolving and counting, a revoke still reaches Kiorex", async () => {
    const l = await mk({ ownerScope: "ORG" });
    t.flags.setSnapshot(snap([{ key: "growth.provider_links", values: { global: "OFF" } }]));
    try {
      const c = await call(t, "POST", G, { token: f.tokens.OWNER, body: { label: "Valid label", ownerScope: "ORG" } });
      assert.equal(c.status, 403); assert.deepEqual([c.body.code, c.body.key], ["FEATURE_DISABLED", "growth.provider_links"]);
      assert.equal((await call(t, "GET", `${G}/${l.id}/qr.svg`, { token: f.tokens.OWNER })).status, 403);
      assert.equal((await call(t, "GET", G, { token: f.tokens.OWNER })).status, 200, "data is never hidden");
      assert.equal((await pub(`/public/links/q/${l.code}`)).status, 302);
      assert.equal((await prisma.providerReferralLinkDaily.findFirstOrThrow({ where: { linkId: l.id } })).visits, 1, "still counting");
      assert.equal((await patch(l.id, { status: "REVOKED" })).status, 200);
      assert.ok((await events(f.orgId, "ReferralLinkRevoked")).some((e) => (e.payload as { data: { linkCode: string } }).data.linkCode === l.code), "the revoke is never flag-gated");
    } finally { t.flags.setSnapshot(null); }
  });

  it("plan limit: LITE allows 3 active links, a revoke frees a slot", async () => {
    const lite = await makeLab(t, { edition: "LITE" }); await connect(lite); const w = lite.tokens.OWNER; const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await call(t, "POST", G, { token: w, body: { label: `Lite ${i} link`, ownerScope: "ORG" } })).body.id);
    const over = await call(t, "POST", G, { token: w, body: { label: "Fourth link", ownerScope: "ORG" } });
    assert.equal(over.status, 409); assert.equal(over.body.code, "GROWTH_LINK_LIMIT_REACHED"); assert.equal(over.body.limit, 3);
    await patch(ids[0]!, { status: "REVOKED" }, w);
    assert.equal((await call(t, "POST", G, { token: w, body: { label: "Fourth link", ownerScope: "ORG" } })).status, 201);
  });

  it("performance and recommendations: counts only, no money, closed catalogue; a paused Kiorex listing is recommended to fix", async () => {
    const perf = (await call(t, "GET", "/growth/performance", { token: f.tokens.OWNER })).body;
    assert.ok(perf.links.visits >= 1); assert.equal(perf.acquisitionPending, true); assert.equal(perf.statement.configured, false);
    const keys: string[] = []; const walk = (o: unknown) => { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { keys.push(k); walk(v); } }; walk(perf);
    assert.deepEqual(keys.filter((k) => /value|price|amount|fee|money|revenue|commission|patient|phone|test/i.test(k)), []);
    const rec = (await call(t, "GET", "/growth/recommendations", { token: f.tokens.OWNER })).body;
    for (const r of rec.items) assert.ok(["CREATE_FIRST_LINK", "PRINT_COUNTER_CARD", "BRANCH_NOT_LISTED", "LINKS_UNUSED", "HIGH_REJECTION"].includes(r.id));
    await prisma.auditLog.create({ data: { orgId: f.orgId, action: "kiorex_listing.paused", entityType: "KiorexListing", entityId: f.orgId, meta: {} } });
    assert.ok(((await call(t, "GET", "/growth/recommendations", { token: f.tokens.OWNER })).body.items as Array<{ id: string }>).some((r) => r.id === "BRANCH_NOT_LISTED"));
    await prisma.auditLog.create({ data: { orgId: f.orgId, action: "kiorex_listing.resumed", entityType: "KiorexListing", entityId: f.orgId, meta: {} } });
  });

  describe("Kiorly staff app: /mobile/growth", () => {
    it("plan gate first: a LITE organisation gets 403 FEATURE_DISABLED (mobile_staff_app) whatever the role", async () => {
      const lite = await makeLab(t, { edition: "LITE" }); await connect(lite);
      for (const role of ["OWNER", "RECEPTION"] as const) { const r = await call(t, "GET", "/mobile/growth", { token: lite.tokens[role] }); assert.equal(r.status, 403); assert.deepEqual([r.body.code, r.body.key], ["FEATURE_DISABLED", "mobile_staff_app"]); }
      assert.equal((await call(t, "POST", "/mobile/growth/links", { token: lite.tokens.OWNER, body: { label: "Valid label" } })).body.code, "FEATURE_DISABLED");
    });
    it("a PRO connected organisation gets the whole tab in one call; staff roles read, owner and manager create, revoke is web only", async () => {
      const first = await mk({ ownerScope: "ORG", label: "App link" });
      const o = await call(t, "GET", "/mobile/growth", { token: f.tokens.OWNER, headers: { "x-kiorly-client": "kiorly/1.0" } }); assert.equal(o.status, 200, JSON.stringify(o.body));
      assert.equal(o.body.product, "LAB"); assert.ok(o.body.links.some((l: { id: string }) => l.id === first.id)); assert.match(o.body.profileUrl, /\/lab$/); assert.equal(o.body.can.revoke, false); assert.equal(o.body.statement.configured, false);
      assert.ok(Array.isArray(o.body.recommendations)); assert.equal(o.body.level, "admin");
      const rec = await call(t, "GET", "/mobile/growth", { token: f.tokens.RECEPTION }); assert.equal(rec.status, 200); assert.equal(rec.body.can.create, false);
      assert.equal((await call(t, "GET", "/mobile/growth", { token: f.tokens.TECHNOLOGIST })).body.code, "GROWTH_FORBIDDEN");
      assert.equal((await call(t, "POST", "/mobile/growth/links", { token: f.tokens.RECEPTION, body: { label: "Valid label", ownerScope: "ORG" } })).body.code, "GROWTH_FORBIDDEN");
      const made = await call(t, "POST", "/mobile/growth/links", { token: f.tokens.BRANCH_MANAGER, body: { label: "From the app", ownerScope: "BRANCH", labId: f.labId } }); assert.equal(made.status, 201, JSON.stringify(made.body));
      assert.equal((await patch(made.body.id, { status: "PAUSED" }, f.tokens.OWNER, "/mobile/growth/links")).body.status, "PAUSED");
      assert.equal((await patch(made.body.id, { status: "REVOKED" }, f.tokens.OWNER, "/mobile/growth/links")).status, 403);
      const qr = await call(t, "GET", `/mobile/growth/qr?linkId=${made.body.id}`, { token: f.tokens.OWNER }); assert.equal(qr.status, 200); assert.match(qr.body as string, /^<svg/);
      assert.equal((await call(t, "GET", "/mobile/growth/qr", { token: f.tokens.OWNER })).status, 400);
      assert.equal((await call(t, "GET", `/mobile/growth/qr?linkId=${made.body.id}`, { token: other.tokens.OWNER })).status, 404, "another organisation");
      assert.equal((await call(t, "GET", "/mobile/growth/links", { token: f.tokens.OWNER })).body.items.length > 0, true);
    });
  });

  it("outbox dispatch (mock transport) signs and delivers the registry events", async () => {
    const r = await t.outbox.dispatchDue(new Date(), 500);
    assert.equal(r.failed, 0);
    assert.ok([...t.outbox.transport.received.values()].some((m) => m.type === "ReferralLinkCreated"));
  });
});
